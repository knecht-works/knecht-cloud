import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Trigger } from '../db/schema'
import type { SessionObject } from './sessions'

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
  pull_request?: {
    number?: number
    title?: string
    body?: string | null
    html_url?: string
    head?: { ref?: string }
    base?: { ref?: string }
  }
  issue?: {
    number?: number
    title?: string
    body?: string | null
    html_url?: string
    pull_request?: object
  }
  comment?: { id?: number, body?: string, user?: { login?: string, type?: string } }
  label?: { name?: string }
}

// Inputs are the same five keys for every trigger kind, so a workflow can
// never reference a variable some trigger cannot provide.
export interface GithubMatch {
  branch: string | null
  inputs: Record<string, string>
  object: SessionObject | null
}

const PR_ACTIONS = new Set(['opened', 'reopened', 'synchronize'])

function branchMatches(filter: string[], branch: string): boolean {
  return filter.length === 0 || filter.includes(branch)
}

export function matchGithubEvent(t: Trigger, event: string, payload: GithubPayload): GithubMatch | null {
  if (event !== (t.webhookEvent ?? 'push')) return null

  const common = { event }

  if (event === 'push') {
    const ref = payload.ref ?? ''
    if (payload.deleted || !ref.startsWith('refs/heads/')) return null
    const branch = ref.slice('refs/heads/'.length)
    if (!branchMatches(t.webhookBranches, branch)) return null
    return {
      branch,
      inputs: {
        ...common,
        identifier: payload.after?.slice(0, 7) ?? '',
        title: payload.head_commit?.message ?? '',
        body: '',
        url: payload.head_commit?.url ?? '',
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
      inputs: {
        ...common,
        identifier: String(payload.pull_request?.number ?? ''),
        title: payload.pull_request?.title ?? '',
        body: payload.pull_request?.body ?? '',
        url: payload.pull_request?.html_url ?? '',
      },
      object: githubObject('pull_request', payload),
    }
  }

  if (event === 'issues') {
    const action = payload.action ?? ''
    if (!t.issueActions.includes(action as (typeof t.issueActions)[number])) return null
    if (action === 'labeled' && (!t.issueLabel || payload.label?.name !== t.issueLabel)) return null
    return {
      branch: null,
      inputs: {
        ...common,
        identifier: String(payload.issue?.number ?? ''),
        title: payload.issue?.title ?? '',
        body: payload.issue?.body ?? '',
        url: payload.issue?.html_url ?? '',
      },
      object: githubObject('issue', payload),
    }
  }

  return null
}

export function githubObject(kind: SessionObject['kind'], payload: GithubPayload): SessionObject | null {
  const subject = kind === 'issue' ? payload.issue : payload.pull_request
  if (typeof subject?.number !== 'number') return null
  return {
    kind,
    number: subject.number,
    url: subject.html_url,
    title: subject.title ?? undefined,
  }
}
