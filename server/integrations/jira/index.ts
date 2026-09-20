import { tryParseJson } from '../../utils/json'
import { linkedProject } from '../../utils/project-links'
import { verifySha256Signature } from '../../utils/signature'
import type { SessionObject } from '../../utils/sessions'
import type { TriggerConfig } from '../../../shared/utils/trigger-form'
import { labelFilter } from '../trigger-config'
import { matchTrackerEvent, trackerComment, trackerContext, trackerStatusChange, trackerTriggerForm, type TrackerChange, type TrackerDef, type TrackerIssue } from '../tracker'
import type { Integration, WebhookComment, WebhookDelivery } from '../types'
import { adfMentionIds, adfToMarkdown, markdownToAdf } from './adf'
import { addJiraComment, forgetJiraCache, getJiraComment, jiraMyself, listJiraIssueTypes, listJiraLabels, listJiraStatuses, getJiraIssueFields, getJiraStatusCategory, jiraIssueUrl, listJiraProjects, listJiraTransitions, transitionJiraIssue, updateJiraLabels, type JiraIssueFields } from './api'
import { JIRA_CONNECTION_FORM, jiraConnection, jiraCredentials } from './credentials'

export const JIRA_STATUS_CATEGORIES = { new: 'To Do', indeterminate: 'In Progress', done: 'Done' } as const

const JIRA_TRACKER: TrackerDef = {
  id: 'jira',
  name: 'Jira',
  noun: 'ticket',
  status: {
    event: 'status',
    groupPrefix: 'category:',
    groupHeading: 'Category',
    groups: JIRA_STATUS_CATEGORIES,
    closedGroups: ['done'],
    options: 'statuses',
  },
  filters: [
    { key: 'issueType', label: 'Issue type is', summary: '{value}', input: 'list', placeholder: 'Pick issue types', optionsUrl: '/api/integrations/jira/options/issueTypes' },
    labelFilter('jira'),
  ],
}

export const jiraTriggerForm = trackerTriggerForm(JIRA_TRACKER)

interface JiraChange {
  field?: string
  from?: string | null
  to?: string | null
  fromString?: string | null
  toString?: string | null
}

export interface JiraPayload {
  webhookEvent?: string
  issue?: { key?: string, fields?: JiraIssueFields }
  changelog?: { items?: JiraChange[] }
  comment?: { id?: string | number }
}

function jiraIssue(key: string, fields: JiraIssueFields): TrackerIssue {
  return {
    object: { integration: 'jira', kind: 'issue', key, url: jiraIssueUrl(key), title: fields.summary },
    body: adfToMarkdown(fields.description),
    status: { name: fields.status?.name ?? '', group: fields.status?.statusCategory?.key ?? '' },
    author: fields.reporter?.displayName ?? '',
    assignees: fields.assignee?.displayName ? [fields.assignee.displayName] : [],
    labels: fields.labels ?? [],
    facts: [['Type', fields.issuetype?.name ?? '']],
  }
}

// Jira lists labels space-separated in the changelog; labels never contain spaces.
function labelsOf(value: string | null | undefined): Set<string> {
  return new Set((value ?? '').split(/\s+/).filter(Boolean))
}

async function jiraChange(payload: JiraPayload, issue: TrackerIssue): Promise<TrackerChange> {
  const fields = payload.issue?.fields ?? {}
  const item = (field: string) => payload.changelog?.items?.find(i => i.field === field)
  const accountId = jiraCredentials()?.accountId
  const status = item('status')
  const before = labelsOf(item('labels')?.fromString)
  return {
    created: payload.webhookEvent === 'jira:issue_created',
    issue: status?.toString ? { ...issue, status: { ...issue.status, name: status.toString } } : issue,
    gainedLabels: [...labelsOf(item('labels')?.toString)].filter(label => !before.has(label)),
    assignedToSelf: !!accountId && fields.assignee?.accountId === accountId,
    gainedSelf: !!accountId && item('assignee')?.to === accountId,
    // The changelog carries status ids, not categories.
    ...(status ? { previousStatus: { group: status.from ? await getJiraStatusCategory(status.from) : null } } : {}),
    filterValues: { issueType: [fields.issuetype?.name ?? ''] },
  }
}

async function parseComment(object: SessionObject, payload: JiraPayload): Promise<WebhookComment | undefined> {
  const id = payload.comment?.id
  if (id === undefined || id === null) return undefined
  const comment = await getJiraComment(object.key, String(id))
  return trackerComment({
    id: comment.id,
    author: { id: comment.author.accountId, name: comment.author.displayName },
    body: adfToMarkdown(comment.body),
    object,
    selfId: jiraCredentials()?.accountId,
    mentionedIds: adfMentionIds(comment.body),
  })
}

export const jira: Integration = {
  id: 'jira',
  name: 'Jira',

  isConfigured: () => !!jiraCredentials()?.webhookSecret,

  trigger: {
    form: jiraTriggerForm,
    options: { statuses: listJiraStatuses, labels: listJiraLabels, issueTypes: listJiraIssueTypes },
  },

  connection: {
    form: JIRA_CONNECTION_FORM,
    store: jiraConnection,
    verify: ({ siteUrl, email, apiToken }) => jiraMyself({ siteUrl: siteUrl!, email: email!, apiToken: apiToken! }),
    onChange: forgetJiraCache,
  },

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
      const key = payload.issue?.key
      const projectKey = payload.issue?.fields?.project?.key
      const project = projectKey ? linkedProject('jira', projectKey) : undefined
      if (!project || !key) return null

      const issue = jiraIssue(key, payload.issue?.fields ?? {})
      const { object } = issue
      const name = payload.webhookEvent ?? ''
      const delivery: WebhookDelivery = { project, summary: `${name} ${object.key}` }
      if (name === 'comment_created') {
        delivery.comment = await parseComment(object, payload)
        return delivery
      }
      if (name === 'jira:issue_deleted') {
        delivery.statusChange = { object, status: 'closed' }
      }
      else if (name === 'jira:issue_created' || name === 'jira:issue_updated') {
        const change = await jiraChange(payload, issue)
        delivery.statusChange = trackerStatusChange(JIRA_TRACKER, change)
        delivery.event = { name, payload: change }
      }
      return delivery
    },

    match(trigger, delivery) {
      if (!delivery.event) return null
      return matchTrackerEvent(JIRA_TRACKER, trigger.config as unknown as TriggerConfig, delivery.event.payload as TrackerChange)
    },
  },

  objects: {
    kinds: ['issue'],
    describe: object => `ticket ${object.key}`,
    async context(_project, object) {
      const fields = await getJiraIssueFields(object.key)
      return trackerContext(jiraIssue(object.key, fields), (fields.comment?.comments ?? []).map(c => ({
        author: c.author?.displayName ?? 'unknown',
        at: new Date(c.created ?? 0),
        body: adfToMarkdown(c.body),
      })))
    },
  },

  mentions: {
    // Whoever can comment on the ticket may address Knecht: the Jira site is the gate.
    allowsAuthor: () => true,
  },

  capabilities: {
    comment: (_project, object, body) => addJiraComment(object.key, markdownToAdf(body)),

    labels: {
      list: listJiraLabels,
      apply: (_project, object, add, remove) => updateJiraLabels(object.key, add, remove),
    },

    statuses: {
      targets: async (_project, object) => (await listJiraTransitions(object.key)).map(t => ({
        name: t.to,
        apply: () => transitionJiraIssue(object.key, t.id),
      })),
    },
  },

  runResult: { noun: 'ticket' },
}
