import { z } from 'zod'
import { getJiraIssue, searchJiraIssueKeys } from '../jira'
import { isJiraConfigured } from '../jira-credentials'
import type { TriggerSourceDef, PollMatch } from './index'

// The 'jira' trigger source: fires when a ticket in one Jira project gains a
// label, reaches a status, or is assigned to the connected Knecht account.
// Detection is a state diff, not events: each poll asks Jira (server-side JQL)
// for the keys currently matching and compares them to the keys seen last
// time. A new key fires once; a key that leaves the set is forgotten, so
// re-labelling / re-assigning a ticket fires again. That makes the poll
// self-healing: a missed tick just means the diff happens on the next one.

const configSchema = z.object({
  projectKey: z.string().trim().min(1),
  // Exactly one condition: the label a ticket gains, the status it reaches, or
  // "assigned to the connected account" (the poll runs as that account, so the
  // JQL is simply currentUser()).
  label: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  assignee: z.literal(true).optional(),
}).refine(
  c => [c.label, c.status, c.assignee].filter(Boolean).length === 1,
  'Pick exactly one condition: a label, a status or assignment',
)

type JiraConfig = z.infer<typeof configSchema>

// JQL string literal: quotes and backslashes escaped.
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

  // Tickets already matching when the trigger is set up are seeded as seen:
  // the trigger reacts to changes from now on, not to the backlog.
  async init(config) {
    const seenKeys = await searchJiraIssueKeys(jql(config as JiraConfig))
    return { seenKeys }
  },

  async poll(trigger) {
    // Disconnected (or not yet connected): skip silently instead of logging an
    // error every tick. The trigger resumes as soon as Jira is connected.
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
          event: 'jira',
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
