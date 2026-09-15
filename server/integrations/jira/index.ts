import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { runWorkspacePath } from '../../../shared/utils/routes'
import { getProject } from '../../utils/entities'
import { emptyInputs, type TriggerInputs } from '../../utils/inputs'
import { tryParseJson } from '../../utils/json'
import { dashboardOrigin } from '../../utils/origin'
import { verifySha256Signature } from '../../utils/signature'
import type { SessionObject } from '../../utils/sessions'
import type { Integration, TriggerMatch, WebhookComment, WebhookDelivery } from '../types'
import { adfMentionIds, adfToMarkdown, markdownToAdf, type AdfNode } from './adf'
import { addJiraComment, getJiraComment, getJiraIssueContext, jiraIssueUrl, listJiraTransitions, transitionJiraIssue, updateJiraLabels } from './api'
import { jiraCredentials, recordJiraDelivery } from './credentials'

export const jiraTriggerConfigSchema = z.object({
  event: z.enum(['created', 'labeled', 'transitioned', 'assigned']),
  label: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  issueType: z.string().trim().min(1).optional(),
}).refine(c => c.event !== 'labeled' || !!c.label, 'A label is required to trigger on "labeled"')
  .refine(c => c.event !== 'transitioned' || !!c.status, 'A status is required to trigger on "transitioned"')

export type JiraTriggerConfig = z.infer<typeof jiraTriggerConfigSchema>

export function jiraEventLabel(c: JiraTriggerConfig): string {
  const condition = c.event === 'created'
    ? 'ticket created'
    : c.event === 'labeled'
      ? `label "${c.label}"`
      : c.event === 'transitioned'
        ? `status "${c.status}"`
        : 'assigned to Knecht'
  return `On ${condition}${c.issueType ? ` · ${c.issueType}` : ''}`
}

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

export function matchJiraEvent(c: JiraTriggerConfig, payload: JiraPayload): TriggerMatch | null {
  const name = payload.webhookEvent ?? ''
  const object = jiraObject(payload)
  if (!object) return null
  if (c.issueType && payload.issue?.fields?.issuetype?.name !== c.issueType) return null

  const accountId = jiraCredentials()?.accountId
  let matched = false
  if (name === 'jira:issue_created') {
    // A ticket born with the label, in the status or assigned to Knecht has no changelog to gain them in.
    const fields = payload.issue?.fields
    matched = c.event === 'created'
      || (c.event === 'labeled' && (fields?.labels ?? []).includes(c.label!))
      || (c.event === 'transitioned' && fields?.status?.name === c.status)
      || (c.event === 'assigned' && !!accountId && fields?.assignee?.accountId === accountId)
  }
  else if (name === 'jira:issue_updated') {
    if (c.event === 'labeled') {
      const labels = change(payload, 'labels')
      matched = !!labels && labelsOf(labels.toString).has(c.label!) && !labelsOf(labels.fromString).has(c.label!)
    }
    else if (c.event === 'transitioned') {
      matched = change(payload, 'status')?.toString === c.status
    }
    else if (c.event === 'assigned') {
      matched = !!accountId && change(payload, 'assignee')?.to === accountId
    }
  }
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

  isConfigured: () => !!jiraCredentials()?.webhookSecret,

  trigger: {
    configSchema: jiraTriggerConfigSchema,
    eventLabel: config => jiraEventLabel(config as JiraTriggerConfig),
    validateProjects(projectIds) {
      if (projectIds.length !== 1) return 'A Jira trigger fires for exactly one project'
      const project = getProject(projectIds[0]!)
      if (!project) return 'Unknown project'
      if (!project.jiraProjectKey) return `Link ${project.fullName} to a Jira project first (project settings)`
      return null
    },
  },

  webhook: {
    verify(raw, header) {
      const secret = jiraCredentials()?.webhookSecret
      return !!secret && verifySha256Signature(raw, secret, header('x-hub-signature') ?? '')
    },

    async parse(raw, _header) {
      const payload = (tryParseJson(raw) ?? {}) as JiraPayload
      const projectKey = payload.issue?.fields?.project?.key
      const project = projectKey
        ? db.select().from(schema.projects).where(eq(schema.projects.jiraProjectKey, projectKey)).get()
        : undefined
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
      return matchJiraEvent(trigger.config as JiraTriggerConfig, delivery.event.payload as JiraPayload)
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
