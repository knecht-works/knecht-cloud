import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { emptyInputs, type TriggerInputs } from '../../utils/inputs'
import { tryParseJson } from '../../utils/json'
import { linkedProject } from '../../utils/project-links'
import { verifySha256Signature } from '../../utils/signature'
import type { SessionObject } from '../../utils/sessions'
import type { TriggerConfig, TriggerFormDef } from '../../../shared/utils/trigger-form'
import { matchesAny, passesList, triggerEvent } from '../trigger-config'
import { labelChangeSummary } from '../capabilities'
import type { Integration, TriggerMatch, WebhookComment, WebhookDelivery } from '../types'
import { addPlaneComment, getPlaneComment, getPlaneWorkItem, getPlaneWorkItemByKey, getPlaneWorkItemContext, listPlaneLabels, listPlaneMembers, listPlaneProjects, listPlaneStates, planeProjectById, planeProjectByIdentifier, planeUserName, planeWorkItemUrl, updatePlaneWorkItem, type PlaneLabel, type PlaneProject, type PlaneState, type PlaneWorkItem } from './api'
import { planeCredentials, recordPlaneDelivery } from './credentials'
import { htmlToMarkdown, markdownToHtml } from './html'

export const PLANE_STATE_GROUPS = { backlog: 'Backlog', unstarted: 'Unstarted', started: 'Started', completed: 'Completed', cancelled: 'Cancelled' } as const

// A state event names either an exact state or, with this prefix, a whole state group.
const GROUP_PREFIX = 'group:'

export const planeTriggerForm: TriggerFormDef = [
  {
    kind: 'issue',
    label: 'Work item',
    events: [
      { type: 'created', label: 'Created', summary: 'work item created' },
      { type: 'assigned', label: 'Assigned to Knecht', summary: 'assigned to Knecht', default: true, hint: 'Fires when a work item is assigned to the account the Plane connection uses, so "give it to Knecht" is a normal assignment in Plane.' },
      { type: 'labeled', label: 'Label added', summary: 'label "{value}"', value: { input: 'select', placeholder: 'Pick a label', optionsUrl: '/api/plane/labels' } },
      {
        type: 'state',
        label: 'State reached',
        summary: 'state "{value}"',
        value: {
          input: 'select',
          default: `${GROUP_PREFIX}completed`,
          optionsHeading: 'Group',
          options: Object.entries(PLANE_STATE_GROUPS).map(([key, label]) => ({ label: `Any ${label}`, value: `${GROUP_PREFIX}${key}`, summary: `any "${label}" state` })),
          optionsUrl: '/api/plane/states',
          remoteHeading: 'Exact state',
        },
      },
    ],
    filters: [
      { key: 'label', label: 'Has label', summary: 'with label {value}', input: 'list', placeholder: 'backend' },
      { key: 'priority', label: 'Priority is', summary: '{value} priority', input: 'list', placeholder: 'urgent, high' },
    ],
  },
]

// Plane serialises empty fields as the string "None" in some deliveries.
function nil<T>(value: T | 'None' | null | undefined): T | undefined {
  return value === 'None' || value === null || value === undefined ? undefined : value
}

export interface PlaneRecord {
  id?: string
  name?: string
  sequence_id?: number
  project_id?: string
  state_id?: string | null
  priority?: string | null
  label_ids?: string[]
  assignee_ids?: string[]
  created_by_id?: string | null
  comment?: { id?: string, actor_id?: string }
}

export interface PlanePayload {
  event?: string
  entity_id?: string
  data?: PlaneRecord
  previous_attributes?: PlaneRecord
}

// Everything `match` needs, resolved once in `parse`: matching is synchronous.
export interface PlaneEvent {
  name: string
  data: PlaneRecord
  previous: PlaneRecord
  labels: PlaneLabel[]
  states: PlaneState[]
  inputs: TriggerInputs
  object: SessionObject
}

const CLOSED_GROUPS = new Set(['completed', 'cancelled'])

function stateMatches(c: TriggerConfig, e: PlaneEvent, stateId: string | undefined): boolean {
  const value = triggerEvent(c, 'state')?.value
  const state = e.states.find(s => s.id === stateId)
  if (!value || !state) return false
  return value.startsWith(GROUP_PREFIX) ? state.group === value.slice(GROUP_PREFIX.length) : state.name === value
}

// A work item born with the label, in the state or assigned to Knecht has no previous attributes to gain them from.
function createdFires(c: TriggerConfig, e: PlaneEvent, labelId: string | undefined, accountId: string | null | undefined): boolean {
  return !!triggerEvent(c, 'created')
    || (!!labelId && (e.data.label_ids ?? []).includes(labelId))
    || stateMatches(c, e, nil(e.data.state_id))
    || (!!triggerEvent(c, 'assigned') && !!accountId && (e.data.assignee_ids ?? []).includes(accountId))
}

function updatedFires(c: TriggerConfig, e: PlaneEvent, labelId: string | undefined, accountId: string | null | undefined): boolean {
  const gained = (now: string[] | undefined, before: string[] | undefined, id: string) => !!before && (now ?? []).includes(id) && !before.includes(id)
  if (labelId && gained(e.data.label_ids, e.previous.label_ids, labelId)) return true
  if (triggerEvent(c, 'assigned') && !!accountId && gained(e.data.assignee_ids, e.previous.assignee_ids, accountId)) return true
  if (e.previous.state_id === undefined || !stateMatches(c, e, nil(e.data.state_id))) return false
  // Moving between two states of one group (Todo to Ready) is not reaching the group.
  const value = triggerEvent(c, 'state')!.value!
  return !value.startsWith(GROUP_PREFIX) || !stateMatches(c, e, nil(e.previous.state_id))
}

export function matchPlaneEvent(c: TriggerConfig, e: PlaneEvent): TriggerMatch | null {
  const labelNames = (e.data.label_ids ?? []).map(id => e.labels.find(l => l.id === id)?.name ?? '').filter(Boolean)
  if (!passesList(c, 'label', wanted => matchesAny(wanted, labelNames))) return null
  if (!passesList(c, 'priority', wanted => matchesAny(wanted, [nil(e.data.priority) ?? 'none'], 'i'))) return null

  const accountId = planeCredentials()?.accountId
  const label = triggerEvent(c, 'labeled')?.value
  const labelId = label ? e.labels.find(l => l.name === label)?.id : undefined
  const matched = e.name === 'workitem.created'
    ? createdFires(c, e, labelId, accountId)
    : e.name === 'workitem.updated' && updatedFires(c, e, labelId, accountId)
  if (!matched) return null
  return { branch: null, inputs: e.inputs, object: e.object }
}

function planeObject(identifier: string, sequenceId: number, title: string | undefined): SessionObject {
  const key = `${identifier}-${sequenceId}`
  return { integration: 'plane', kind: 'issue', key, url: planeWorkItemUrl(key), title }
}

interface Located {
  planeProject: PlaneProject
  workItemId: string
}

function linkedPlaneKeys(): string[] {
  return db.select({ key: schema.projectLinks.externalKey })
    .from(schema.projectLinks)
    .where(eq(schema.projectLinks.integration, 'plane'))
    .all()
    .map(r => r.key)
}

// A comment delivery names the work item but not its project: probe the linked projects for it.
async function locate(record: PlaneRecord, workItemId: string | undefined): Promise<Located | null> {
  const projectId = nil(record.project_id)
  if (projectId) {
    const planeProject = await planeProjectById(projectId)
    return planeProject && workItemId ? { planeProject, workItemId } : null
  }
  if (!workItemId) return null
  for (const identifier of linkedPlaneKeys()) {
    const planeProject = (await listPlaneProjects()).find(p => p.identifier === identifier)
    if (!planeProject) continue
    if (await getPlaneWorkItem(planeProject.id, workItemId).then(() => true, () => false)) return { planeProject, workItemId }
  }
  return null
}

async function parseComment(located: Located, object: SessionObject, record: PlaneRecord): Promise<WebhookComment | undefined> {
  const commentId = nil(record.comment?.id)
  if (!commentId) return undefined
  const comment = await getPlaneComment(located.planeProject.id, located.workItemId, commentId)
  const html = comment.comment_html ?? ''
  const body = htmlToMarkdown(html)
  const accountId = planeCredentials()?.accountId ?? ''
  return {
    id: comment.id,
    author: { id: comment.actor?.id ?? '', name: planeUserName(comment.actor) },
    body,
    fromSelf: !!accountId && comment.actor?.id === accountId,
    // A Plane mention is a node carrying the user's id; the plain handle covers instances where the account is not mentionable.
    mentionsKnecht: (!!accountId && html.includes(accountId)) || /@knecht\b/i.test(body),
    object,
  }
}

async function planeInputs(located: Located, object: SessionObject, data: PlaneRecord, item: PlaneWorkItem): Promise<{ inputs: TriggerInputs, labels: PlaneLabel[], states: PlaneState[] }> {
  const [states, labels, members] = await Promise.all([
    listPlaneStates(located.planeProject.id),
    listPlaneLabels(located.planeProject.id),
    listPlaneMembers(located.planeProject.id),
  ])
  const name = (id: string | null | undefined) => members.find(m => m.id === id)?.displayName ?? ''
  const inputs: TriggerInputs = {
    ...emptyInputs('issue'),
    identifier: object.key,
    title: data.name ?? item.name,
    body: htmlToMarkdown(item.description_html),
    url: object.url ?? '',
    status: states.find(s => s.id === nil(data.state_id ?? item.state))?.name ?? '',
    assignee: (data.assignee_ids ?? item.assignees ?? []).map(name).filter(Boolean).join(', '),
    labels: (data.label_ids ?? item.labels ?? []).map(id => labels.find(l => l.id === id)?.name ?? '').filter(Boolean).join(', '),
    author: name(nil(data.created_by_id) ?? item.created_by),
  }
  return { inputs, labels, states }
}

async function locateObject(object: SessionObject): Promise<Located & { item: PlaneWorkItem }> {
  const planeProject = await planeProjectByIdentifier(object.key.replace(/-\d+$/, ''))
  const item = await getPlaneWorkItemByKey(object.key)
  return { planeProject, workItemId: item.id, item }
}

export const plane: Integration = {
  id: 'plane',
  name: 'Plane',

  isConfigured: () => !!planeCredentials()?.webhookSecret,

  trigger: { form: planeTriggerForm },

  link: {
    label: 'Plane project',
    listTargets: async () => (await listPlaneProjects()).map(p => ({ key: p.identifier, name: p.name })),
  },

  webhook: {
    verify(raw, header) {
      const secret = planeCredentials()?.webhookSecret
      // Plane sends the bare hex digest, without GitHub's `sha256=` prefix.
      return !!secret && verifySha256Signature(raw, secret, `sha256=${header('x-plane-signature') ?? ''}`)
    },

    async parse(raw, header) {
      const payload = (tryParseJson(raw) ?? {}) as PlanePayload
      const name = header('x-plane-event') || payload.event || ''
      const deleted = name === 'workitem.deleted'
      const record = (deleted ? payload.previous_attributes : payload.data) ?? {}
      const located = await locate(record, nil(record.id) ?? nil(payload.entity_id))
      const project = located ? linkedProject('plane', located.planeProject.identifier) : undefined
      if (!located || !project) return null

      const item = deleted ? undefined : await getPlaneWorkItem(located.planeProject.id, located.workItemId)
      const sequenceId = nil(record.sequence_id) ?? item?.sequence_id
      if (!sequenceId) return null
      const object = planeObject(located.planeProject.identifier, sequenceId, record.name ?? item?.name)
      const delivery: WebhookDelivery = { project, summary: `${name} ${object.key}` }

      if (name === 'workitem.comment.created') {
        delivery.comment = await parseComment(located, object, record)
        return delivery
      }
      if (deleted || name === 'workitem.archived') {
        delivery.statusChange = { object, status: 'closed' }
        return delivery
      }
      if (item && (name === 'workitem.created' || name === 'workitem.updated')) {
        const data = payload.data ?? {}
        const previous = payload.previous_attributes ?? {}
        const { inputs, labels, states } = await planeInputs(located, object, data, item)
        if (name === 'workitem.updated' && previous.state_id !== undefined) {
          const group = states.find(s => s.id === nil(data.state_id))?.group ?? ''
          delivery.statusChange = { object, status: CLOSED_GROUPS.has(group) ? 'closed' : 'open' }
        }
        const event: PlaneEvent = { name, data, previous, labels, states, inputs, object }
        delivery.event = { name, payload: event }
      }
      return delivery
    },

    match(trigger, delivery) {
      if (!delivery.event) return null
      return matchPlaneEvent(trigger.config as unknown as TriggerConfig, delivery.event.payload as PlaneEvent)
    },

    record: recordPlaneDelivery,
  },

  objects: {
    kinds: ['issue'],
    describe: object => `work item ${object.key}`,
    async context(_project, object) {
      const planeProject = await planeProjectByIdentifier(object.key.replace(/-\d+$/, ''))
      return getPlaneWorkItemContext(planeProject.id, object.key)
    },
  },

  mentions: {
    // Whoever can comment on the work item may address Knecht: the Plane workspace is the gate.
    allowsAuthor: () => true,
  },

  capabilities: {
    async comment(_project, object, body) {
      const { planeProject, workItemId } = await locateObject(object)
      await addPlaneComment(planeProject.id, workItemId, markdownToHtml(body))
      return { url: planeWorkItemUrl(object.key) }
    },

    async label(_project, object, add, remove) {
      const { planeProject, workItemId, item } = await locateObject(object)
      const labels = await listPlaneLabels(planeProject.id)
      const idOf = (name: string) => labels.find(l => l.name === name)?.id
      const unknown = [...add, ...remove].filter(name => !idOf(name))
      if (unknown.length) {
        throw new Error(`these labels do not exist in the Plane project and Knecht never creates labels: ${unknown.join(', ')}. Existing labels: ${labels.map(l => l.name).join(', ') || '(none)'}`)
      }
      const removeIds = new Set(remove.map(idOf))
      const next = [...new Set([...(item.labels ?? []), ...add.map(idOf)])].filter((id): id is string => !!id && !removeIds.has(id))
      await updatePlaneWorkItem(planeProject.id, workItemId, { labels: next })
      return labelChangeSummary(add, remove)
    },

    async setStatus(_project, object, status) {
      const { planeProject, workItemId } = await locateObject(object)
      const states = await listPlaneStates(planeProject.id)
      const state = states.find(s => s.name.toLowerCase() === status.trim().toLowerCase())
      if (!state) {
        throw new Error(`no state "${status}" in the Plane project. Available: ${states.map(s => s.name).join(', ') || '(none)'}`)
      }
      await updatePlaneWorkItem(planeProject.id, workItemId, { state: state.id })
      return `moved to "${state.name}"`
    },
  },

  runResult: { noun: 'work item' },
}
