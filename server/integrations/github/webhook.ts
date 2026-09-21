import { emptyInputs, type TriggerInputs } from '../../utils/inputs'
import type { SessionObject } from '../../utils/sessions'
import type { TriggerConfig, TriggerFilterDef, TriggerFormDef } from '../../../shared/utils/trigger-form'
import { labeledEvent, labelFilter, matchesAny, passesList, triggerEvent } from '../trigger-config'
import type { TriggerMatch } from '../types'

const LABEL_FILTER = labelFilter('github')
const BRANCHES_URL = '/api/integrations/github/options/branches'
const AUTHOR_FILTERS: TriggerFilterDef[] = [
  { key: 'author', label: 'Author is', summary: 'by {value}', input: 'list', placeholder: 'octocat, renovate[bot]' },
  { key: 'authorNot', label: 'Author is not', summary: 'not by {value}', input: 'list', placeholder: 'renovate[bot], dependabot[bot]' },
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
      { key: 'base', label: 'Base branch matches', summary: 'base {value}', input: 'list', placeholder: 'main, releases/*', optionsUrl: BRANCHES_URL },
      { key: 'head', label: 'Head branch matches', summary: 'head {value}', input: 'list', placeholder: 'renovate/*', optionsUrl: BRANCHES_URL },
      ...AUTHOR_FILTERS,
      LABEL_FILTER,
      {
        key: 'draft',
        label: 'Draft state is',
        summary: '{value}',
        input: 'select',
        options: [{ label: 'Not a draft', value: 'ready', summary: 'no drafts' }, { label: 'Draft', value: 'draft', summary: 'drafts only' }],
      },
    ],
  },
  {
    kind: 'issue',
    label: 'Issues',
    events: [
      { type: 'opened', label: 'Opened', summary: 'opened', default: true },
      labeledEvent('github'),
      { type: 'assigned', label: 'Assigned to', summary: 'assigned to {value}', value: { input: 'text', placeholder: 'octocat' } },
    ],
    filters: [...AUTHOR_FILTERS, LABEL_FILTER],
  },
]

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

function subjectPasses(c: TriggerConfig, subject: GithubSubject | undefined): boolean {
  const author = subject?.user?.login ?? ''
  const labels = (subject?.labels ?? []).map(l => l.name ?? '')
  return passesList(c, 'author', allowed => matchesAny(allowed, [author]))
    && passesList(c, 'authorNot', denied => !matchesAny(denied, [author]))
    && passesList(c, 'label', wanted => matchesAny(wanted, labels))
}

function labelFires(c: TriggerConfig, payload: GithubPayload): boolean {
  const label = triggerEvent(c, 'labeled')?.value
  return !!label && label === payload.label?.name
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
    const login = triggerEvent(c, 'assigned')?.value
    return !!login && sameLogin(login, payload.assignee?.login ?? '')
  }
  return false
}

export function matchGithubEvent(c: TriggerConfig, event: string, payload: GithubPayload): TriggerMatch | null {
  if (event === 'pull_request' && c.kind === 'pull_request') {
    const pr = payload.pull_request
    if (!pullRequestFires(c, payload) || !subjectPasses(c, pr)) return null
    if (!passesList(c, 'draft', ([state]) => (state === 'draft') === !!pr?.draft)) return null
    if (!passesList(c, 'base', allowed => matchesAny(allowed, [pr?.base?.ref ?? '']))) return null
    const head = pr?.head?.ref ?? ''
    if (!passesList(c, 'head', patterns => matchesAny(patterns, [head]))) return null
    return {
      // The filters are about the pull request; the run checks out its head.
      branch: head || null,
      inputs: subjectInputs(event, pr),
      object: githubObject('pull_request', pr),
    }
  }

  if (event === 'issues' && c.kind === 'issue') {
    if (!issueFires(c, payload) || !subjectPasses(c, payload.issue)) return null
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
