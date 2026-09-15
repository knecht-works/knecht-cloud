import { z } from 'zod'
import { getJiraIssue, searchJiraIssueKeys } from '../jira'
import { isJiraConfigured } from '../jira-credentials'
import { emptyInputs } from '../inputs'
import type { TriggerSourceDef, PollMatch } from './index'

const configSchema = z.object({
  projectKey: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  assignee: z.literal(true).optional(),
}).refine(
  c => [c.label, c.status, c.assignee].filter(Boolean).length === 1,
  'Pick exactly one condition: a label, a status or assignment',
)

type JiraConfig = z.infer<typeof configSchema>

function q(value: string): string {
  return `"${value.replace(/[\\"]/g, ch => `\\${ch}`)}"`
}

function jql(config: JiraConfig): string {
  const condition = config.label
    ? `labels = ${q(config.label)}`
    : config.status
      ? `status = ${q(config.status)}`
      : 'assignee = currentUser()'
  return `project = ${q(config.projectKey)} AND ${condition}`
}

export const jiraSource: TriggerSourceDef<'jira'> = {
  source: 'jira',

  configSchema,

  eventLabel(config) {
    const c = config as JiraConfig
    const condition = c.label
      ? `label ${q(c.label)}`
      : c.status
        ? `status ${q(c.status)}`
        : 'assigned to Knecht'
    return `On ${c.projectKey} · ${condition}`
  },

  async init(config) {
    const seenKeys = await searchJiraIssueKeys(jql(config as JiraConfig))
    return { seenKeys }
  },

  async poll(trigger) {
    if (!isJiraConfigured()) return { matches: [], state: trigger.state }

    const config = trigger.config as JiraConfig
    const keys = await searchJiraIssueKeys(jql(config))

    const seen = new Set(Array.isArray(trigger.state.seenKeys) ? trigger.state.seenKeys as string[] : [])
    const matches: PollMatch[] = []
    for (const key of keys) {
      if (seen.has(key)) continue
      const issue = await getJiraIssue(key)
      matches.push({
        inputs: {
          ...emptyInputs('jira'),
          identifier: issue.key,
          title: issue.title,
          body: issue.body,
          url: issue.url,
        },
      })
    }

    return { matches, state: { seenKeys: keys } }
  },
}
