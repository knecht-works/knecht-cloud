import { emptyInputs, type TriggerInputs } from '../../utils/inputs'
import type { SessionObject } from '../../utils/sessions'
import type { TriggerConfig, TriggerFilterDef, TriggerFormDef } from '../../../shared/utils/trigger-form'
import { conditionsPass, labeledEvent, labelFilter, listedOnlyKeys, triggerEvent } from '../trigger-config'
import type { TriggerMatch } from '../types'

const LABEL_FILTER = labelFilter('github')
const BRANCHES_URL = '/api/integrations/github/options/branches'
const DRAFT_FILTER: TriggerFilterDef = {
  key: 'draft',
  label: 'PR state',
  listedOnly: true,
  placeholder: 'Pick a state',
  options: [{ label: 'Draft', value: 'draft' }, { label: 'Ready for review', value: 'ready' }],
}
const ASSIGNEES_URL = '/api/integrations/github/options/assignees'
const PEOPLE_FILTERS: TriggerFilterDef[] = [
  { key: 'author', label: 'Author', placeholder: 'octocat, renovate[bot]', optionsUrl: ASSIGNEES_URL },
  { key: 'assignee', label: 'Assignee', placeholder: 'octocat', optionsUrl: ASSIGNEES_URL },
]

export const githubTriggerForm: TriggerFormDef = [
  {
    kind: 'pull_request',
    label: 'Pull request',
    events: [
      { type: 'opened', label: 'Opened', summary: 'opened', default: true },
      { type: 'ready_for_review', label: 'Ready for review', summary: 'ready for review' },
      { type: 'pushed', label: 'New commits pushed', summary: 'pushed', hint: 'Starts a run on every push to the pull request, force pushes included.' },
      labeledEvent('github'),
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
      labeledEvent('github'),
      { type: 'assigned', label: 'Assigned to', summary: 'assigned to {value}', value: { placeholder: 'octocat', optionsUrl: ASSIGNEES_URL } },
    ],
    filters: [...PEOPLE_FILTERS, LABEL_FILTER],
  },
]

const EXACT = listedOnlyKeys([LABEL_FILTER, DRAFT_FILTER])

export interface GithubPayload {
  action?: string
  repository?: { id?: number, full_name?: string }
  sender?: { login?: string }
  pull_request?: GithubSubject & {
    draft?: boolean
    head?: { ref?: string }
    base?: { ref?: string }
  }
  issue?: GithubSubject & {
    pull_request?: object
  }
  comment?: { id?: number, body?: string, user?: { login?: string, type?: string } }
  label?: { name?: string }
  assignee?: { login?: string }
}

export interface GithubSubject {
  number?: number
  title?: string
  body?: string | null
  html_url?: string
  state?: string
  user?: { login?: string }
  assignees?: { login?: string }[]
  labels?: { name?: string }[]
}

function subjectInputs(event: string, subject: GithubSubject | undefined): TriggerInputs {
  return {
    ...emptyInputs(event),
    identifier: String(subject?.number ?? ''),
    title: subject?.title ?? '',
    body: subject?.body ?? '',
    url: subject?.html_url ?? '',
    status: subject?.state ?? '',
    assignee: subject?.assignees?.[0]?.login ?? '',
    labels: (subject?.labels ?? []).map(l => l.name).filter(Boolean).join(', '),
    author: subject?.user?.login ?? '',
  }
}

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function subjectFields(subject: GithubSubject | undefined): Record<string, string[]> {
  return {
    author: [subject?.user?.login ?? ''],
    assignee: (subject?.assignees ?? []).map(a => a.login ?? ''),
    label: (subject?.labels ?? []).map(l => l.name ?? ''),
  }
}

function labelFires(c: TriggerConfig, payload: GithubPayload): boolean {
  const name = payload.label?.name
  return !!name && !!triggerEvent(c, 'labeled')?.values?.includes(name)
}

function pullRequestFires(c: TriggerConfig, payload: GithubPayload): boolean {
  const action = payload.action ?? ''
  if (action === 'opened' || action === 'reopened') return !!triggerEvent(c, 'opened')
  if (action === 'ready_for_review') return !!triggerEvent(c, 'ready_for_review')
  if (action === 'synchronize') return !!triggerEvent(c, 'pushed')
  if (action === 'labeled') return labelFires(c, payload)
  return false
}

function issueFires(c: TriggerConfig, payload: GithubPayload): boolean {
  const action = payload.action ?? ''
  if (action === 'opened') return !!triggerEvent(c, 'opened')
  if (action === 'labeled') return labelFires(c, payload)
  if (action === 'assigned') {
    const login = payload.assignee?.login ?? ''
    return !!login && !!triggerEvent(c, 'assigned')?.values?.some(l => sameLogin(l, login))
  }
  return false
}

export function matchGithubEvent(c: TriggerConfig, event: string, payload: GithubPayload): TriggerMatch | null {
  if (event === 'pull_request' && c.kind === 'pull_request') {
    const pr = payload.pull_request
    if (!pullRequestFires(c, payload)) return null
    const head = pr?.head?.ref ?? ''
    const fields = { ...subjectFields(pr), draft: [pr?.draft ? 'draft' : 'ready'], base: [pr?.base?.ref ?? ''], head: [head] }
    if (!conditionsPass(c, fields, EXACT)) return null
    return {
      // The conditions are about the pull request; the run checks out its head.
      branch: head || null,
      inputs: subjectInputs(event, pr),
      object: githubObject('pull_request', pr),
    }
  }

  if (event === 'issues' && c.kind === 'issue') {
    if (!issueFires(c, payload) || !conditionsPass(c, subjectFields(payload.issue), EXACT)) return null
    return {
      branch: null,
      inputs: subjectInputs(event, payload.issue),
      object: githubObject('issue', payload.issue),
    }
  }

  return null
}

export function githubObject(kind: SessionObject['kind'], subject: GithubSubject | undefined): SessionObject | null {
  if (typeof subject?.number !== 'number') return null
  return {
    integration: 'github',
    kind,
    key: String(subject.number),
    url: subject.html_url,
    title: subject.title ?? undefined,
  }
}
