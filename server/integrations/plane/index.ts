import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { tryParseJson } from '../../utils/json'
import { linkedProject } from '../../utils/project-links'
import { verifySha256Signature } from '../../utils/signature'
import type { SessionObject } from '../../utils/sessions'
import type { TriggerConfig } from '../../../shared/utils/trigger-form'
import { labelChangeSummary } from '../capabilities'
import { LABEL_FILTER, matchTrackerEvent, trackerComment, trackerContext, trackerStatusChange, trackerTriggerForm, type TrackerChange, type TrackerDef, type TrackerIssue } from '../tracker'
import type { Integration, WebhookComment, WebhookDelivery } from '../types'
import { addPlaneComment, forgetPlaneCache, getPlaneComment, planeMyself, getPlaneWorkItem, getPlaneWorkItemByKey, listPlaneComments, listPlaneLabels, listPlaneMembers, listPlaneProjects, listPlaneStates, planeProjectById, planeProjectByIdentifier, planeUserName, planeWorkItemUrl, updatePlaneWorkItem, type PlaneLabel, type PlaneMember, type PlaneProject, type PlaneState, type PlaneWorkItem } from './api'
import { PLANE_CONNECTION_FORM, planeConnection, planeCredentials } from './credentials'
import { htmlMentionIds, htmlToMarkdown, markdownToHtml } from './html'

export const PLANE_STATE_GROUPS = { backlog: 'Backlog', unstarted: 'Unstarted', started: 'Started', completed: 'Completed', cancelled: 'Cancelled' } as const

const PLANE_TRACKER: TrackerDef = {
  id: 'plane',
  name: 'Plane',
  noun: 'work item',
  defaultEvent: 'assigned',
  labelValue: { input: 'select', placeholder: 'Pick a label', optionsUrl: '/api/integrations/plane/options/labels' },
  status: {
    event: 'state',
    groupPrefix: 'group:',
    groupHeading: 'Group',
    groups: PLANE_STATE_GROUPS,
    closedGroups: ['completed', 'cancelled'],
    options: 'states',
  },
  filters: [
    LABEL_FILTER,
    { key: 'priority', label: 'Priority is', summary: '{value} priority', input: 'list', placeholder: 'urgent, high' },
  ],
}

export const planeTriggerForm = trackerTriggerForm(PLANE_TRACKER)

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
  return trackerComment({
    id: comment.id,
    author: { id: comment.actor?.id ?? '', name: planeUserName(comment.actor) },
    body: htmlToMarkdown(comment.comment_html),
    object,
    selfId: planeCredentials()?.accountId,
    mentionedIds: htmlMentionIds(comment.comment_html),
  })
}

interface PlaneLookups {
  states: PlaneState[]
  labels: PlaneLabel[]
  members: PlaneMember[]
}

async function planeLookups(projectId: string): Promise<PlaneLookups> {
  const [states, labels, members] = await Promise.all([listPlaneStates(projectId), listPlaneLabels(projectId), listPlaneMembers(projectId)])
  return { states, labels, members }
}

function planeIssue(object: SessionObject, item: PlaneWorkItem, { states, labels, members }: PlaneLookups): TrackerIssue {
  const state = states.find(s => s.id === item.state)
  const member = (id: string | null | undefined) => members.find(m => m.id === id)?.displayName ?? ''
  return {
    object,
    body: htmlToMarkdown(item.description_html),
    status: { name: state?.name ?? '', group: state?.group ?? '' },
    author: member(item.created_by),
    assignees: (item.assignees ?? []).map(member).filter(Boolean),
    labels: (item.labels ?? []).map(id => labels.find(l => l.id === id)?.name ?? '').filter(Boolean),
  }
}

// The delivery is newer than the fetched work item wherever it carries the field.
function deliveredItem(item: PlaneWorkItem, data: PlaneRecord): PlaneWorkItem {
  return {
    ...item,
    name: data.name ?? item.name,
    state: nil(data.state_id) ?? item.state,
    labels: data.label_ids ?? item.labels,
    assignees: data.assignee_ids ?? item.assignees,
    created_by: nil(data.created_by_id) ?? item.created_by,
  }
}

function planeChange(created: boolean, data: PlaneRecord, previous: PlaneRecord, issue: TrackerIssue, { states, labels }: PlaneLookups): TrackerChange {
  const accountId = planeCredentials()?.accountId
  const gained = (now: string[] | undefined, before: string[] | undefined) => before ? (now ?? []).filter(id => !before.includes(id)) : []
  return {
    created,
    issue,
    gainedLabels: gained(data.label_ids, previous.label_ids).map(id => labels.find(l => l.id === id)?.name ?? '').filter(Boolean),
    assignedToSelf: !!accountId && (data.assignee_ids ?? []).includes(accountId),
    gainedSelf: !!accountId && gained(data.assignee_ids, previous.assignee_ids).includes(accountId),
    ...(previous.state_id !== undefined ? { previousStatus: { group: states.find(s => s.id === nil(previous.state_id))?.group ?? null } } : {}),
    filterValues: { priority: [nil(data.priority) ?? 'none'] },
  }
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

  trigger: {
    form: planeTriggerForm,
    options: {
      labels: async identifier => (await listPlaneLabels((await planeProjectByIdentifier(identifier)).id)).map(l => l.name),
      states: async identifier => (await listPlaneStates((await planeProjectByIdentifier(identifier)).id)).map(s => s.name),
    },
  },

  connection: {
    form: PLANE_CONNECTION_FORM,
    store: planeConnection,
    verify: ({ siteUrl, workspaceSlug, apiKey }) => planeMyself({ siteUrl: siteUrl!, workspaceSlug: workspaceSlug!, apiKey: apiKey! }),
    onChange: forgetPlaneCache,
  },

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
        const lookups = await planeLookups(located.planeProject.id)
        const issue = planeIssue(object, deliveredItem(item, data), lookups)
        const change = planeChange(name === 'workitem.created', data, payload.previous_attributes ?? {}, issue, lookups)
        delivery.statusChange = trackerStatusChange(PLANE_TRACKER, change)
        delivery.event = { name, payload: change }
      }
      return delivery
    },

    match(trigger, delivery) {
      if (!delivery.event) return null
      return matchTrackerEvent(PLANE_TRACKER, trigger.config as unknown as TriggerConfig, delivery.event.payload as TrackerChange)
    },
  },

  objects: {
    kinds: ['issue'],
    describe: object => `work item ${object.key}`,
    async context(_project, object) {
      const { planeProject, item } = await locateObject(object)
      const [lookups, comments] = await Promise.all([planeLookups(planeProject.id), listPlaneComments(planeProject.id, item.id)])
      const issue = planeIssue(planeObject(planeProject.identifier, item.sequence_id, item.name), item, lookups)
      return trackerContext(issue, comments.map(c => ({
        author: planeUserName(c.actor) || 'unknown',
        at: new Date(c.created_at || 0),
        body: htmlToMarkdown(c.comment_html),
      })))
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
