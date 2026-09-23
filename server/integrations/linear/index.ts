import { tryParseJson } from '../../utils/json'
import { linkedProject } from '../../utils/project-links'
import { verifySha256Signature } from '../../utils/signature'
import type { TriggerConfig } from '../../../shared/utils/trigger-form'
import { labelFilter, objectVersion, priorityFilter } from '../trigger-config'
import { matchTrackerEvent, trackerComment, trackerContext, trackerStatusChange, trackerTriggerForm, type TrackerChange, type TrackerDef, type TrackerIssue } from '../tracker'
import type { Integration, WebhookDelivery } from '../types'
import { addLinearComment, forgetLinearCache, getLinearComment, getLinearIssue, linearMyself, listLinearComments, listLinearLabels, listLinearStates, listLinearTeams, updateLinearIssue, type LinearIssue, type LinearState } from './api'
import { LINEAR_CONNECTION_FORM, linearConnection, linearCredentials } from './credentials'
import { bodyDataMentionIds } from './mentions'

export const LINEAR_STATE_TYPES = { triage: 'Triage', backlog: 'Backlog', unstarted: 'Unstarted', started: 'Started', completed: 'Completed', canceled: 'Canceled' } as const

// Indexed by Linear's numeric priority.
const LINEAR_PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low']

const LINEAR_TRACKER: TrackerDef = {
  id: 'linear',
  name: 'Linear',
  noun: 'issue',
  status: {
    event: 'status',
    groupPrefix: 'type:',
    groupHeading: 'Category',
    groups: LINEAR_STATE_TYPES,
    closedGroups: ['completed', 'canceled'],
    options: 'statuses',
  },
  filters: [
    labelFilter('linear'),
    priorityFilter(),
  ],
}

export const linearTriggerForm = trackerTriggerForm(LINEAR_TRACKER)

export interface LinearRecord {
  id?: string
  identifier?: string
  title?: string
  url?: string
  stateId?: string
  assigneeId?: string | null
  labelIds?: string[]
  updatedAt?: string
  archivedAt?: string | null
  trashed?: boolean | null
}

export interface LinearPayload {
  action?: string
  type?: string
  actor?: { id?: string, name?: string }
  data?: LinearRecord
  updatedFrom?: LinearRecord
}

// An identifier is the team key and the issue number: ENG-12.
const teamKeyOf = (identifier: string) => identifier.replace(/-\d+$/, '')

function linearIssue(issue: LinearIssue): TrackerIssue {
  return {
    object: { integration: 'linear', kind: 'issue', key: issue.identifier, url: issue.url, title: issue.title },
    body: issue.description ?? '',
    status: { name: issue.state?.name ?? '', group: issue.state?.type ?? '' },
    author: issue.creator?.name ?? '',
    assignees: issue.assignee?.name ? [issue.assignee.name] : [],
    labels: (issue.labels?.nodes ?? []).map(l => l.name),
    facts: [['Priority', LINEAR_PRIORITIES[issue.priority ?? 0] ?? '']],
  }
}

function linearChange(payload: LinearPayload, fetched: LinearIssue, states: LinearState[]): TrackerChange {
  const accountId = linearCredentials()?.accountId
  const previous = payload.updatedFrom ?? {}
  const gainedIds = previous.labelIds ? (payload.data?.labelIds ?? []).filter(id => !previous.labelIds!.includes(id)) : []
  const assignedToSelf = !!accountId && fetched.assignee?.id === accountId
  // Linear delivers Knecht's own writes too: taking an issue must not fire "assigned to Knecht" again,
  // while a label or status the agent sets may well start the next workflow.
  const bySelf = !!accountId && payload.actor?.id === accountId
  return {
    created: payload.action === 'create',
    issue: linearIssue(fetched),
    gainedLabels: (fetched.labels?.nodes ?? []).filter(l => gainedIds.includes(l.id)).map(l => l.name),
    assignedToSelf,
    // `updatedFrom.assigneeId` is null when the issue was unassigned before.
    gainedSelf: !bySelf && assignedToSelf && 'assigneeId' in previous,
    ...(previous.stateId ? { previousStatus: { group: states.find(s => s.id === previous.stateId)?.type ?? null } } : {}),
    filterValues: { priority: [LINEAR_PRIORITIES[fetched.priority ?? 0] ?? 'none'] },
    version: objectVersion(payload.data?.updatedAt),
    ...(payload.actor?.id && !bySelf ? { actor: { id: payload.actor.id, name: payload.actor.name ?? '' } } : {}),
  }
}

function requireSelf(): string {
  const accountId = linearCredentials()?.accountId
  if (!accountId) throw new Error('the Linear connection does not know its own account: connect Linear again')
  return accountId
}

async function parseComment(commentId: string, name: string): Promise<WebhookDelivery | null> {
  const comment = await getLinearComment(commentId)
  const project = comment.issue ? linkedProject('linear', teamKeyOf(comment.issue.identifier)) : undefined
  if (!comment.issue || !project) return null
  const { object } = linearIssue(comment.issue)
  return {
    project,
    summary: `${name} ${object.key}`,
    comment: trackerComment({
      id: comment.id,
      author: { id: comment.user?.id ?? '', name: comment.user?.name ?? '' },
      body: comment.body ?? '',
      object,
      selfId: linearCredentials()?.accountId,
      mentionedIds: bodyDataMentionIds(comment.bodyData),
    }),
  }
}

export const linear: Integration = {
  id: 'linear',
  name: 'Linear',

  isConfigured: () => !!linearCredentials()?.webhookSecret,

  trigger: {
    form: linearTriggerForm,
    options: {
      labels: async teamKey => (await listLinearLabels(teamKey)).map(l => l.name),
      statuses: async teamKey => (await listLinearStates(teamKey)).map(s => s.name),
    },
  },

  connection: {
    form: LINEAR_CONNECTION_FORM,
    store: linearConnection,
    verify: ({ apiKey }) => linearMyself({ apiKey: apiKey! }),
    onChange: forgetLinearCache,
  },

  link: {
    label: 'Linear team',
    listTargets: async () => (await listLinearTeams()).map(t => ({ key: t.key, name: t.name })),
  },

  webhook: {
    verify(raw, header) {
      const secret = linearCredentials()?.webhookSecret
      return !!secret && verifySha256Signature(raw, secret, header('linear-signature') ?? '', '')
    },

    async parse(raw) {
      const payload = (tryParseJson(raw) ?? {}) as LinearPayload
      const name = `${payload.type}.${payload.action}`
      const data = payload.data ?? {}
      if (name === 'Comment.create') return data.id ? await parseComment(data.id, name) : null
      if (payload.type !== 'Issue' || !data.id || !data.identifier) return null
      const teamKey = teamKeyOf(data.identifier)
      const project = linkedProject('linear', teamKey)
      if (!project) return null

      const delivery: WebhookDelivery = { project, summary: `${name} ${data.identifier}` }
      if (payload.action === 'remove' || data.archivedAt || data.trashed) {
        delivery.statusChange = { object: { integration: 'linear', kind: 'issue', key: data.identifier, url: data.url, title: data.title }, status: 'closed' }
        return delivery
      }
      const [fetched, states] = await Promise.all([getLinearIssue(data.id), listLinearStates(teamKey)])
      const change = linearChange(payload, fetched, states)
      delivery.statusChange = trackerStatusChange(LINEAR_TRACKER, change)
      delivery.event = { name, payload: change }
      return delivery
    },

    match(trigger, delivery) {
      if (!delivery.event) return null
      return matchTrackerEvent(LINEAR_TRACKER, trigger.config as unknown as TriggerConfig, delivery.event.payload as TrackerChange)
    },
  },

  objects: {
    kinds: ['issue'],
    describe: object => `issue ${object.key}`,
    async context(_project, object) {
      const [issue, comments] = await Promise.all([getLinearIssue(object.key), listLinearComments(object.key)])
      return trackerContext(linearIssue(issue), comments.map(c => ({
        author: c.user?.name || 'unknown',
        at: new Date(c.createdAt || 0),
        body: c.body ?? '',
      })))
    },
  },

  mentions: {
    // Whoever can comment on the issue may address Knecht: the Linear workspace is the gate.
    allowsAuthor: () => true,
  },

  capabilities: {
    comment: async (_project, object, body) => addLinearComment((await getLinearIssue(object.key)).id, body),

    labels: {
      list: async (_project, object) => (await listLinearLabels(teamKeyOf(object.key))).map(l => l.name),
      async apply(_project, object, add, remove) {
        const labels = await listLinearLabels(teamKeyOf(object.key))
        const idsOf = (names: string[]) => labels.filter(l => names.includes(l.name)).map(l => l.id)
        await updateLinearIssue(object.key, { addedLabelIds: idsOf(add), removedLabelIds: idsOf(remove) })
      },
    },

    statuses: {
      async targets(_project, object) {
        return (await listLinearStates(teamKeyOf(object.key))).map(state => ({
          name: state.name,
          apply: () => updateLinearIssue(object.key, { stateId: state.id }),
        }))
      },
    },

    assignee: {
      async take(_project, object) {
        const self = requireSelf()
        const { assignee } = await getLinearIssue(object.key)
        if (assignee?.id === self) return null
        await updateLinearIssue(object.key, { assigneeId: self })
        return assignee ? { id: assignee.id, name: assignee.name ?? '' } : null
      },
      async handBack(_project, object, to) {
        const self = requireSelf()
        const { assignee, creator } = await getLinearIssue(object.key)
        // Somebody took the issue from Knecht meanwhile: it is theirs.
        if (assignee?.id !== self) return `left ${object.key} with ${assignee?.name ?? 'nobody'}`
        const candidates = [to, creator?.id && creator.id !== self ? { id: creator.id, name: creator.name ?? '' } : null]
        for (const person of candidates) {
          if (person && await updateLinearIssue(object.key, { assigneeId: person.id }).then(() => true, () => false)) {
            return `handed ${object.key} back to ${person.name}`
          }
        }
        await updateLinearIssue(object.key, { assigneeId: null })
        return `left ${object.key} unassigned`
      },
    },
  },

  runResult: { noun: 'issue' },
}
