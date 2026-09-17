import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { runWorkspacePath } from '../../../shared/utils/routes'
import { emptyInputs, type TriggerInputs } from '../../utils/inputs'
import { tryParseJson } from '../../utils/json'
import { dashboardOrigin } from '../../utils/origin'
import { linkedProject } from '../../utils/project-links'
import { verifySha256Signature } from '../../utils/signature'
import type { SessionObject } from '../../utils/sessions'
import type { Integration, TriggerMatch, WebhookComment, WebhookDelivery } from '../types'
import { addPlaneComment, getPlaneComment, getPlaneWorkItem, getPlaneWorkItemByKey, getPlaneWorkItemContext, listPlaneLabels, listPlaneMembers, listPlaneProjects, listPlaneStates, planeProjectById, planeProjectByIdentifier, planeWorkItemUrl, updatePlaneWorkItem, type PlaneLabel, type PlaneProject, type PlaneState, type PlaneWorkItem } from './api'
import { planeCredentials, recordPlaneDelivery } from './credentials'
import { htmlToMarkdown, markdownToHtml } from './html'

export const planeTriggerConfigSchema = z.object({
  event: z.enum(['created', 'labeled', 'transitioned', 'assigned']),
  label: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
}).refine(c => c.event !== 'labeled' || !!c.label, 'A label is required to trigger on "labeled"')
  .refine(c => c.event !== 'transitioned' || !!c.state, 'A state is required to trigger on "transitioned"')

export type PlaneTriggerConfig = z.infer<typeof planeTriggerConfigSchema>

export function planeEventLabel(c: PlaneTriggerConfig): string {
  const condition = c.event === 'created'
    ? 'work item created'
    : c.event === 'labeled'
      ? `label "${c.label}"`
      : c.event === 'transitioned'
        ? `state "${c.state}"`
        : 'assigned to Knecht'
  return `On ${condition}`
}

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

export function matchPlaneEvent(c: PlaneTriggerConfig, e: PlaneEvent): TriggerMatch | null {
  const accountId = planeCredentials()?.accountId
  const labelId = c.label ? e.labels.find(l => l.name === c.label)?.id : undefined
  const stateId = c.state ? e.states.find(s => s.name === c.state)?.id : undefined
  const labelIds = e.data.label_ids ?? []
  const assigneeIds = e.data.assignee_ids ?? []

  let matched = false
  if (e.name === 'workitem.created') {
    matched = c.event === 'created'
      || (c.event === 'labeled' && !!labelId && labelIds.includes(labelId))
      || (c.event === 'transitioned' && !!stateId && nil(e.data.state_id) === stateId)
      || (c.event === 'assigned' && !!accountId && assigneeIds.includes(accountId))
  }
  else if (e.name === 'workitem.updated') {
    if (c.event === 'labeled') {
      matched = !!labelId && !!e.previous.label_ids && labelIds.includes(labelId) && !e.previous.label_ids.includes(labelId)
    }
    else if (c.event === 'transitioned') {
      matched = !!stateId && e.previous.state_id !== undefined && nil(e.data.state_id) === stateId
    }
    else if (c.event === 'assigned') {
      matched = !!accountId && !!e.previous.assignee_ids && assigneeIds.includes(accountId) && !e.previous.assignee_ids.includes(accountId)
    }
  }
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
  const body = htmlToMarkdown(comment.html)
  const accountId = planeCredentials()?.accountId ?? ''
  return {
    id: comment.id,
    author: { id: comment.actor.id, name: comment.actor.displayName },
    body,
    fromSelf: !!accountId && comment.actor.id === accountId,
    // A Plane mention is a node carrying the user's id; the plain handle covers instances where the account is not mentionable.
    mentionsKnecht: (!!accountId && comment.html.includes(accountId)) || /@knecht\b/i.test(body),
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
    body: htmlToMarkdown(item.descriptionHtml),
    url: object.url ?? '',
    status: states.find(s => s.id === nil(data.state_id ?? item.stateId))?.name ?? '',
    assignee: (data.assignee_ids ?? item.assigneeIds).map(name).filter(Boolean).join(', '),
    labels: (data.label_ids ?? item.labelIds).map(id => labels.find(l => l.id === id)?.name ?? '').filter(Boolean).join(', '),
    author: name(nil(data.created_by_id) ?? item.createdById),
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

  trigger: {
    configSchema: planeTriggerConfigSchema,
    eventLabel: config => planeEventLabel(config as PlaneTriggerConfig),
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
      const sequenceId = nil(record.sequence_id) ?? item?.sequenceId
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
      return matchPlaneEvent(trigger.config as PlaneTriggerConfig, delivery.event.payload as PlaneEvent)
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
      const next = [...new Set([...item.labelIds, ...add.map(idOf)])].filter((id): id is string => !!id && !removeIds.has(id))
      await updatePlaneWorkItem(planeProject.id, workItemId, { labels: next })
      return [add.length ? `added ${add.join(', ')}` : '', remove.length ? `removed ${remove.join(', ')}` : ''].filter(Boolean).join('; ')
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

  async onRunFinished(project, session, run, status) {
    const key = session.objectKey
    if (!key) return
    const { planeProject, workItemId } = await locateObject({ integration: 'plane', kind: 'issue', key })
    if (status === 'success') {
      if (!run.prUrl) return
      await addPlaneComment(planeProject.id, workItemId, markdownToHtml(`Knecht opened a pull request for this work item: ${run.prUrl}`))
      return
    }
    await addPlaneComment(planeProject.id, workItemId, markdownToHtml(`Knecht could not finish the run for this work item: ${dashboardOrigin()}${runWorkspacePath(project.id, run.id)}`))
  },
}
