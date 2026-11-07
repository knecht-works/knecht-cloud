import type { TriggerFilterDef, TriggerFormDef } from '../../shared/utils/trigger-form'
import { labeledEvent, labelFilter, listedOnlyKeys } from './trigger-config'

const LABELS_URL = '/api/git/options/labels'
const LABEL_FILTER = labelFilter(LABELS_URL)
const BRANCHES_URL = '/api/git/options/branches'
const DRAFT_FILTER: TriggerFilterDef = {
  key: 'draft',
  label: 'PR state',
  listedOnly: true,
  placeholder: 'Pick a state',
  options: [{ label: 'Draft', value: 'draft' }, { label: 'Ready for review', value: 'ready' }],
}
const ASSIGNEES_URL = '/api/git/options/assignees'
const PEOPLE_FILTERS: TriggerFilterDef[] = [
  { key: 'author', label: 'Author', placeholder: 'octocat, renovate[bot]', optionsUrl: ASSIGNEES_URL },
  { key: 'assignee', label: 'Assignee', placeholder: 'octocat', optionsUrl: ASSIGNEES_URL },
]

export const gitTriggerForm: TriggerFormDef = [
  {
    kind: 'pull_request',
    label: 'Pull request',
    events: [
      { type: 'opened', label: 'Opened', summary: 'opened', default: true },
      { type: 'ready_for_review', label: 'Ready for review', summary: 'ready for review' },
      { type: 'pushed', label: 'New commits pushed', summary: 'pushed', hint: 'Starts a run on every push to the pull request, force pushes included.' },
      labeledEvent(LABELS_URL),
    ],
    filters: [
      { key: 'base', label: 'Base branch', placeholder: 'main, releases/*', optionsUrl: BRANCHES_URL },
      { key: 'head', label: 'Head branch', placeholder: 'renovate/*', optionsUrl: BRANCHES_URL },
      ...PEOPLE_FILTERS,
      LABEL_FILTER,
      DRAFT_FILTER,
    ],
  },
  {
    kind: 'issue',
    label: 'Issue',
    events: [
      { type: 'opened', label: 'Opened', summary: 'opened', default: true },
      labeledEvent(LABELS_URL),
      { type: 'assigned', label: 'Assigned to', summary: 'assigned to {value}', value: { placeholder: 'octocat', optionsUrl: ASSIGNEES_URL } },
    ],
    filters: [...PEOPLE_FILTERS, LABEL_FILTER],
  },
]

export const GIT_EXACT_FILTERS = listedOnlyKeys([LABEL_FILTER, DRAFT_FILTER])
