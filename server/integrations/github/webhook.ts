import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Trigger } from '../../db/schema'
import { emptyInputs, type TriggerInputs } from '../../utils/inputs'
import type { SessionObject } from '../../utils/sessions'

export function verifyGithubSignature(raw: string, secret: string, provided: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface GithubPayload {
  action?: string
  ref?: string
  deleted?: boolean
  after?: string
  head_commit?: { message?: string, url?: string } | null
  pusher?: { name?: string }
  repository?: { id?: number, full_name?: string }
  sender?: { login?: string }
  pull_request?: GithubSubject & {
    head?: { ref?: string }
    base?: { ref?: string }
  }
  issue?: GithubSubject & {
    pull_request?: object
  }
  comment?: { id?: number, body?: string, user?: { login?: string, type?: string } }
  label?: { name?: string }
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

export interface GithubMatch {
  branch: string | null
  inputs: TriggerInputs
  object: SessionObject | null
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

const PR_ACTIONS = new Set(['opened', 'reopened', 'synchronize'])

function branchMatches(filter: string[], branch: string): boolean {
  return filter.length === 0 || filter.includes(branch)
}

export function matchGithubEvent(t: Trigger, event: string, payload: GithubPayload): GithubMatch | null {
  if (event !== (t.webhookEvent ?? 'push')) return null

  if (event === 'push') {
    const ref = payload.ref ?? ''
    if (payload.deleted || !ref.startsWith('refs/heads/')) return null
    const branch = ref.slice('refs/heads/'.length)
    if (!branchMatches(t.webhookBranches, branch)) return null
    return {
      branch,
      inputs: {
        ...emptyInputs(event),
        identifier: payload.after?.slice(0, 7) ?? '',
        title: payload.head_commit?.message ?? '',
        url: payload.head_commit?.url ?? '',
        author: payload.pusher?.name ?? '',
      },
      object: null,
    }
  }

  if (event === 'pull_request') {
    if (!PR_ACTIONS.has(payload.action ?? '')) return null
    const base = payload.pull_request?.base?.ref ?? ''
    if (!branchMatches(t.webhookBranches, base)) return null
    // The branch filter is about the base; the run checks out the head.
    const head = payload.pull_request?.head?.ref ?? ''
    return {
      branch: head || null,
      inputs: subjectInputs(event, payload.pull_request),
      object: githubObject('pull_request', payload.pull_request),
    }
  }

  if (event === 'issues') {
    const action = payload.action ?? ''
    if (!t.issueActions.includes(action as (typeof t.issueActions)[number])) return null
    if (action === 'labeled' && (!t.issueLabel || payload.label?.name !== t.issueLabel)) return null
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
