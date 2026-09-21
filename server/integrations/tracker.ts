import { emptyInputs, type TriggerInputs } from '../utils/inputs'
import { formatObjectContext, type ObjectContext } from '../utils/object-context'
import type { SessionObject } from '../utils/sessions'
import type { IntegrationId } from '../../shared/utils/integrations'
import type { TriggerConfig, TriggerFilterDef, TriggerFormDef } from '../../shared/utils/trigger-form'
import { labeledEvent, matchesAny, passesList, triggerEvent } from './trigger-config'
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
  // Values for the filters besides `labelFilter`.
  filterValues: Record<string, string[]>
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

export function trackerTriggerForm(def: TrackerDef): TriggerFormDef {
  const { status } = def
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
          summary: `${status.event} "{value}"`,
          value: {
            input: 'select',
            default: `${status.groupPrefix}${status.closedGroups[0]}`,
            optionsHeading: status.groupHeading,
            options: Object.entries(status.groups).map(([key, label]) => ({ label: `Any ${label}`, value: `${status.groupPrefix}${key}`, summary: `any "${label}" ${status.event}` })),
            optionsUrl: `/api/integrations/${def.id}/options/${status.options}`,
            remoteHeading: `Exact ${status.event}`,
          },
        },
      ],
      filters: def.filters,
    },
  ]
}

export function matchTrackerEvent(def: TrackerDef, c: TriggerConfig, change: TrackerChange): TriggerMatch | null {
  const { issue } = change
  if (!passesList(c, 'label', wanted => matchesAny(wanted, issue.labels))) return null
  for (const [key, values] of Object.entries(change.filterValues)) {
    if (!passesList(c, key, wanted => matchesAny(wanted, values))) return null
  }

  const label = triggerEvent(c, 'labeled')?.value
  const wantsSelf = !!triggerEvent(c, 'assigned')
  const target = triggerEvent(c, def.status.event)?.value
  const group = target?.startsWith(def.status.groupPrefix) ? target.slice(def.status.groupPrefix.length) : undefined
  const inTarget = !!target && (group === undefined ? issue.status.name === target : issue.status.group === group)

  // An object born with the label, in the status or assigned to Knecht has nothing to gain them from.
  const fires = change.created
    ? !!triggerEvent(c, 'created') || (!!label && issue.labels.includes(label)) || inTarget || (wantsSelf && change.assignedToSelf)
    : (!!label && change.gainedLabels.includes(label))
      || (wantsSelf && change.gainedSelf)
      // Moving between two statuses of one group (In Progress to In Review) is not reaching the group.
      || (inTarget && !!change.previousStatus && (group === undefined || change.previousStatus.group !== group))
  if (!fires) return null
  return { branch: null, inputs: trackerInputs(issue), object: issue.object }
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
