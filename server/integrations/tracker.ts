import { emptyInputs, type TriggerInputs } from '../utils/inputs'
import { formatObjectContext, type ObjectContext } from '../utils/object-context'
import type { SessionObject } from '../utils/sessions'
import type { IntegrationId } from '../../shared/utils/integrations'
import type { TriggerConfig, TriggerFilterDef, TriggerFormDef } from '../../shared/utils/trigger-form'
import { conditionsPass, labeledEvent, listedOnlyKeys, triggerEvent } from './trigger-config'
import type { CommentAuthor, TriggerMatch, WebhookComment, WebhookDelivery } from './types'

// Issue trackers share one set of rules: when a trigger fires, what a run gets as
// inputs, what the agent reads as context, what counts as a mention. An integration
// only maps its payloads and API answers onto the shapes below.

export interface TrackerDef {
  id: IntegrationId
  name: string
  noun: string
  status: {
    // Stored in trigger configs, so each tracker keeps its own word and prefix.
    event: string
    groupPrefix: string
    groupHeading: string
    groups: Record<string, string>
    closedGroups: readonly string[]
    // Name of the `trigger.options` list holding the exact statuses.
    options: string
  }
  filters: TriggerFilterDef[]
}

export interface TrackerIssue {
  object: SessionObject
  body: string
  status: { name: string, group: string }
  author: string
  assignees: string[]
  labels: string[]
  facts?: [string, string][]
}

export interface TrackerChange {
  created: boolean
  issue: TrackerIssue
  gainedLabels: string[]
  assignedToSelf: boolean
  gainedSelf: boolean
  // Set when this update changed the status; the group is null when the tracker does not tell.
  previousStatus?: { group: string | null }
  // Values for the tracker's own filters; label, status and assignment are filled in here.
  filterValues: Record<string, string[]>
  version: string | null
  actor?: Person
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export function trackerTriggerForm(def: TrackerDef): TriggerFormDef {
  const { status } = def
  const statusOptions = {
    optionsHeading: status.groupHeading,
    options: Object.entries(status.groups).map(([key, label]) => ({ label: `Any ${label}`, value: `${status.groupPrefix}${key}`, summary: `any ${label} ${status.event}` })),
    optionsUrl: `/api/integrations/${def.id}/options/${status.options}`,
    remoteHeading: `Exact ${status.event}`,
    listedOnly: true,
  }
  return [
    {
      kind: 'issue',
      label: capitalize(def.noun),
      events: [
        { type: 'created', label: 'Created', summary: `${def.noun} created` },
        {
          type: 'assigned',
          label: 'Assigned to Knecht',
          summary: 'assigned to Knecht',
          default: true,
          hint: `Fires when a ${def.noun} is assigned to the account the ${def.name} connection uses, so "give it to Knecht" is a normal assignment in ${def.name}.`,
        },
        labeledEvent(def.id),
        {
          type: status.event,
          label: `${capitalize(status.event)} reached`,
          summary: `${status.event} {value}`,
          value: {
            default: `${status.groupPrefix}${status.closedGroups[0]}`,
            ...statusOptions,
          },
        },
      ],
      filters: [
        { key: status.event, label: capitalize(status.event), placeholder: `Pick a ${status.event}`, ...statusOptions },
        { key: 'assignee', label: 'Assignee', listedOnly: true, placeholder: 'Pick an assignee', options: [{ label: 'Knecht', value: 'self' }] },
        ...def.filters,
      ],
    },
  ]
}

export function matchTrackerEvent(def: TrackerDef, c: TriggerConfig, change: TrackerChange): TriggerMatch | null {
  const { issue } = change
  const fields = {
    ...change.filterValues,
    label: issue.labels,
    [def.status.event]: [issue.status.name, `${def.status.groupPrefix}${issue.status.group}`],
    assignee: change.assignedToSelf ? ['self'] : [],
  }
  if (!conditionsPass(c, fields, listedOnlyKeys(trackerTriggerForm(def)[0]!.filters))) return null

  const labels = triggerEvent(c, 'labeled')?.values ?? []
  const wantsSelf = !!triggerEvent(c, 'assigned')
  const reached = (target: string) => {
    const group = target.startsWith(def.status.groupPrefix) ? target.slice(def.status.groupPrefix.length) : undefined
    const inTarget = group === undefined ? issue.status.name === target : issue.status.group === group
    // Moving between two statuses of one group (In Progress to In Review) is not reaching the group,
    // and neither is being created in it.
    return inTarget && !!change.previousStatus && (group === undefined || change.previousStatus.group !== group)
  }

  // An object born with the label or assigned to Knecht has nothing to gain them from.
  const fires = (change.created && !!triggerEvent(c, 'created'))
    || labels.some(l => (change.created ? issue.labels : change.gainedLabels).includes(l))
    || (wantsSelf && (change.created ? change.assignedToSelf : change.gainedSelf))
    || (triggerEvent(c, def.status.event)?.values ?? []).some(reached)
  if (!fires) return null
  return { branch: null, inputs: trackerInputs(issue), object: issue.object, version: change.version, actor: change.actor ?? null }
}

export function trackerStatusChange(def: TrackerDef, change: TrackerChange): WebhookDelivery['statusChange'] {
  if (change.created || !change.previousStatus) return undefined
  return { object: change.issue.object, status: def.status.closedGroups.includes(change.issue.status.group) ? 'closed' : 'open' }
}

export function trackerInputs(issue: TrackerIssue): TriggerInputs {
  return {
    ...emptyInputs('issue'),
    identifier: issue.object.key,
    title: issue.object.title ?? '',
    body: issue.body,
    url: issue.object.url ?? '',
    status: issue.status.name,
    assignee: issue.assignees.join(', '),
    labels: issue.labels.join(', '),
    author: issue.author,
  }
}

export function trackerContext(issue: TrackerIssue, comments: ObjectContext['comments']): string {
  return formatObjectContext({
    heading: `${issue.object.key}: ${issue.object.title ?? ''}`,
    url: issue.object.url ?? '',
    facts: [
      ...(issue.facts ?? []),
      ['Status', issue.status.name],
      ['Author', issue.author],
      ['Assignees', issue.assignees.join(', ')],
      ['Labels', issue.labels.join(', ')],
    ],
    body: issue.body,
    comments,
  })
}

interface TrackerCommentInput {
  id: string
  author: CommentAuthor
  body: string
  object: SessionObject
  // The account the connection uses; unknown on connections made before it was stored.
  selfId: string | null | undefined
  mentionedIds: string[]
}

export function trackerComment({ selfId, mentionedIds, ...comment }: TrackerCommentInput): WebhookComment {
  return {
    ...comment,
    fromSelf: !!selfId && comment.author.id === selfId,
    // The plain handle covers trackers where the connection account is not mentionable.
    mentionsKnecht: (!!selfId && mentionedIds.includes(selfId)) || /@knecht\b/i.test(comment.body),
  }
}

export interface Person {
  id: string
  name: string
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The agent writes "@Display Name" as it saw it in the thread; a tracker turns each match into its own mention node.
export function splitMentions(text: string, people: Person[]): (string | Person)[] {
  const named = people.filter(p => p.name)
  if (!named.length) return [text]
  const names = [...new Set(named.map(p => p.name))].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')
  const re = new RegExp(`@(${names})(?![\\p{L}\\p{N}])`, 'gu')
  const parts: (string | Person)[] = []
  let last = 0
  for (const match of text.matchAll(re)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(named.find(p => p.name === match[1])!)
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
