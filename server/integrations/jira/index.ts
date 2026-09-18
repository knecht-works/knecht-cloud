import { runWorkspacePath } from '../../../shared/utils/routes'
import { emptyInputs, type TriggerInputs } from '../../utils/inputs'
import { tryParseJson } from '../../utils/json'
import { dashboardOrigin } from '../../utils/origin'
import { linkedProject } from '../../utils/project-links'
import { verifySha256Signature } from '../../utils/signature'
import type { SessionObject } from '../../utils/sessions'
import type { TriggerConfig, TriggerFormDef } from '../../../shared/utils/trigger-form'
import { passesList, triggerEvent } from '../trigger-config'
import type { Integration, TriggerMatch, WebhookComment, WebhookDelivery } from '../types'
import { adfMentionIds, adfToMarkdown, markdownToAdf, type AdfNode } from './adf'
import { addJiraComment, getJiraComment, getJiraIssueContext, getJiraStatusCategory, jiraIssueUrl, listJiraProjects, listJiraTransitions, transitionJiraIssue, updateJiraLabels } from './api'
import { jiraCredentials, recordJiraDelivery } from './credentials'

export const JIRA_STATUS_CATEGORIES = { new: 'To Do', indeterminate: 'In Progress', done: 'Done' } as const

// A status event names either an exact status or, with this prefix, a whole category.
const CATEGORY_PREFIX = 'category:'

export const jiraTriggerForm: TriggerFormDef = [
  {
    kind: 'issue',
    label: 'Ticket',
    events: [
      { type: 'created', label: 'Created', summary: 'ticket created' },
      { type: 'assigned', label: 'Assigned to Knecht', summary: 'assigned to Knecht', hint: 'Fires when a ticket is assigned to the account the Jira connection uses, so "give it to Knecht" is a normal assignment in Jira.' },
      { type: 'labeled', label: 'Label added', summary: 'label "{value}"', default: true, value: { input: 'text', placeholder: 'Label name, e.g. knecht', default: 'knecht' } },
      {
        type: 'status',
        label: 'Status reached',
        summary: 'status "{value}"',
        value: {
          input: 'select',
          default: `${CATEGORY_PREFIX}done`,
          optionsHeading: 'Category',
          options: Object.entries(JIRA_STATUS_CATEGORIES).map(([key, label]) => ({ label: `Any ${label}`, value: `${CATEGORY_PREFIX}${key}`, summary: `any "${label}" status` })),
          optionsUrl: '/api/jira/statuses',
          remoteHeading: 'Exact status',
        },
      },
    ],
    filters: [
      { key: 'issueType', label: 'Issue type is', summary: '{value}', input: 'list', placeholder: 'Bug, Task' },
      { key: 'label', label: 'Has label', summary: 'with label {value}', input: 'list', placeholder: 'backend' },
    ],
  },
]

interface JiraUser {
  accountId?: string
  displayName?: string
}

interface JiraChange {
  field?: string
  from?: string | null
  to?: string | null
  fromString?: string | null
  toString?: string | null
}

export interface JiraPayload {
  webhookEvent?: string
  issue?: {
    key?: string
    fields?: {
      summary?: string
      description?: AdfNode | null
      status?: { name?: string, statusCategory?: { key?: string } }
      assignee?: JiraUser | null
      reporter?: JiraUser | null
      labels?: string[]
      issuetype?: { name?: string }
      project?: { key?: string }
    }
  }
  changelog?: { items?: JiraChange[] }
  comment?: { id?: string | number }
}

export function jiraObject(payload: JiraPayload): SessionObject | null {
  const key = payload.issue?.key
  if (!key) return null
  return {
    integration: 'jira',
    kind: 'issue',
    key,
    url: jiraIssueUrl(key),
    title: payload.issue?.fields?.summary,
  }
}

function issueInputs(payload: JiraPayload): TriggerInputs {
  const fields = payload.issue?.fields ?? {}
  const key = payload.issue?.key ?? ''
  return {
    ...emptyInputs('issue'),
    identifier: key,
    title: fields.summary ?? '',
    body: adfToMarkdown(fields.description),
    url: key ? jiraIssueUrl(key) : '',
    status: fields.status?.name ?? '',
    assignee: fields.assignee?.displayName ?? '',
    labels: (fields.labels ?? []).join(', '),
    author: fields.reporter?.displayName ?? '',
  }
}

function change(payload: JiraPayload, field: string): JiraChange | undefined {
  return payload.changelog?.items?.find(item => item.field === field)
}

// Jira lists labels space-separated in the changelog; labels never contain spaces.
function labelsOf(value: string | null | undefined): Set<string> {
  return new Set((value ?? '').split(/\s+/).filter(Boolean))
}

// A status change stays inside its category (In Progress to In Review) more often than
// it crosses one; only the crossing counts. The changelog carries status ids, not categories.
async function enteredCategory(category: string, payload: JiraPayload): Promise<boolean> {
  const status = change(payload, 'status')
  if (!status || payload.issue?.fields?.status?.statusCategory?.key !== category) return false
  const from = status.from ? await getJiraStatusCategory(status.from) : null
  return from !== category
}

function statusTarget(c: TriggerConfig): { category?: string, status?: string } {
  const value = triggerEvent(c, 'status')?.value
  if (!value) return {}
  return value.startsWith(CATEGORY_PREFIX) ? { category: value.slice(CATEGORY_PREFIX.length) } : { status: value }
}

// A ticket born with the label, in the status or assigned to Knecht has no changelog to gain them in.
function createdFires(c: TriggerConfig, payload: JiraPayload, accountId: string | null | undefined): boolean {
  const fields = payload.issue?.fields
  const label = triggerEvent(c, 'labeled')?.value
  const { category, status } = statusTarget(c)
  return !!triggerEvent(c, 'created')
    || (!!label && (fields?.labels ?? []).includes(label))
    || (!!category && fields?.status?.statusCategory?.key === category)
    || (!!status && fields?.status?.name === status)
    || (!!triggerEvent(c, 'assigned') && !!accountId && fields?.assignee?.accountId === accountId)
}

async function updatedFires(c: TriggerConfig, payload: JiraPayload, accountId: string | null | undefined): Promise<boolean> {
  const label = triggerEvent(c, 'labeled')?.value
  const labels = change(payload, 'labels')
  if (label && labels && labelsOf(labels.toString).has(label) && !labelsOf(labels.fromString).has(label)) return true

  const { category, status } = statusTarget(c)
  if (status && change(payload, 'status')?.toString === status) return true

  if (triggerEvent(c, 'assigned') && !!accountId && change(payload, 'assignee')?.to === accountId) return true

  return !!category && await enteredCategory(category, payload)
}

export async function matchJiraEvent(c: TriggerConfig, payload: JiraPayload): Promise<TriggerMatch | null> {
  const name = payload.webhookEvent ?? ''
  const object = jiraObject(payload)
  if (!object) return null
  const fields = payload.issue?.fields
  if (!passesList(c, 'issueType', types => types.includes(fields?.issuetype?.name ?? ''))) return null
  if (!passesList(c, 'label', wanted => wanted.some(label => (fields?.labels ?? []).includes(label)))) return null

  const accountId = jiraCredentials()?.accountId
  const matched = name === 'jira:issue_created'
    ? createdFires(c, payload, accountId)
    : name === 'jira:issue_updated' && await updatedFires(c, payload, accountId)
  if (!matched) return null
  return { branch: null, inputs: issueInputs(payload), object }
}

async function parseComment(object: SessionObject, payload: JiraPayload): Promise<WebhookComment | undefined> {
  const id = payload.comment?.id
  if (id === undefined || id === null) return undefined
  const comment = await getJiraComment(object.key, String(id))
  const body = adfToMarkdown(comment.body)
  const accountId = jiraCredentials()?.accountId ?? ''
  return {
    id: comment.id,
    author: { id: comment.author.accountId, name: comment.author.displayName },
    body,
    fromSelf: !!accountId && comment.author.accountId === accountId,
    mentionsKnecht: (!!accountId && adfMentionIds(comment.body).includes(accountId)) || /@knecht\b/i.test(body),
    object,
  }
}

export const jira: Integration = {
  id: 'jira',
  name: 'Jira',

  isConfigured: () => !!jiraCredentials()?.webhookSecret,

  trigger: { form: jiraTriggerForm },

  link: {
    label: 'Jira project',
    listTargets: listJiraProjects,
  },

  webhook: {
    verify(raw, header) {
      const secret = jiraCredentials()?.webhookSecret
      return !!secret && verifySha256Signature(raw, secret, header('x-hub-signature') ?? '')
    },

    async parse(raw, _header) {
      const payload = (tryParseJson(raw) ?? {}) as JiraPayload
      const projectKey = payload.issue?.fields?.project?.key
      const project = projectKey ? linkedProject('jira', projectKey) : undefined
      const object = jiraObject(payload)
      if (!project || !object) return null

      const name = payload.webhookEvent ?? ''
      const delivery: WebhookDelivery = { project, summary: `${name} ${object.key}` }
      if (name === 'comment_created') {
        delivery.comment = await parseComment(object, payload)
        return delivery
      }
      if (name === 'jira:issue_deleted') {
        delivery.statusChange = { object, status: 'closed' }
      }
      else if (name === 'jira:issue_updated' && change(payload, 'status')) {
        const done = payload.issue?.fields?.status?.statusCategory?.key === 'done'
        delivery.statusChange = { object, status: done ? 'closed' : 'open' }
      }
      delivery.event = { name, payload }
      return delivery
    },

    match(trigger, delivery) {
      if (!delivery.event) return null
      return matchJiraEvent(trigger.config as unknown as TriggerConfig, delivery.event.payload as JiraPayload)
    },

    record: recordJiraDelivery,
  },

  objects: {
    kinds: ['issue'],
    describe: object => `ticket ${object.key}`,
    context: (_project, object) => getJiraIssueContext(object.key),
  },

  mentions: {
    // Whoever can comment on the ticket may address Knecht: the Jira site is the gate.
    allowsAuthor: () => true,
  },

  capabilities: {
    comment: (_project, object, body) => addJiraComment(object.key, markdownToAdf(body)),

    async label(_project, object, add, remove) {
      await updateJiraLabels(object.key, add, remove)
      return [add.length ? `added ${add.join(', ')}` : '', remove.length ? `removed ${remove.join(', ')}` : ''].filter(Boolean).join('; ')
    },

    async setStatus(_project, object, status) {
      const transitions = await listJiraTransitions(object.key)
      const transition = transitions.find(t => t.to.toLowerCase() === status.trim().toLowerCase())
      if (!transition) {
        throw new Error(`no transition to "${status}" from the current status. Reachable: ${transitions.map(t => t.to).join(', ') || '(none)'}`)
      }
      await transitionJiraIssue(object.key, transition.id)
      return `moved to "${transition.to}"`
    },
  },

  async onRunFinished(project, session, run, status) {
    const key = session.objectKey
    if (!key) return
    if (status === 'success') {
      if (!run.prUrl) return
      await addJiraComment(key, markdownToAdf(`Knecht opened a pull request for this ticket: ${run.prUrl}`))
      return
    }
    await addJiraComment(key, markdownToAdf(`Knecht could not finish the run for this ticket: ${dashboardOrigin()}${runWorkspacePath(project.id, run.id)}`))
  },
}
