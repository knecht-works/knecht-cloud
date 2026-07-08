import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Trigger } from '../db/schema'

// Logic for the GitHub App webhook receiver (server/api/github/webhook.post.ts):
// verify the delivery against the app's webhook secret, then match it against a
// trigger's event + filters and derive the run overrides.

// Timing-safe check of GitHub's `x-hub-signature-256` header against the HMAC
// of the raw body.
export function verifyGithubSignature(raw: string, secret: string, provided: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  return a.length === b.length && timingSafeEqual(a, b)
}

// The slice of GitHub's webhook payloads the matcher reads. All optional:
// deliveries are external input.
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
  issue?: { number?: number, title?: string, body?: string | null, html_url?: string }
  label?: { name?: string }
}

// What a matched delivery starts the run with: the branch to check out (null =
// the project's default branch) and the event data steps read as {{ inputs.* }}.
//
// Inputs follow a UNIFIED contract so one workflow serves any trigger kind:
// exactly `event` (what happened, e.g. 'issues'), `identifier`, `title`,
// `body` and `url` (the subject: the issue, the PR, the head commit; later
// e.g. a Jira ticket). Nothing event-specific, so a workflow can never
// reference a variable some trigger can't provide. `identifier` stays a
// string so future sources can carry keys like PROJ-123.
export interface GithubMatch {
  branch: string | null
  inputs: Record<string, string>
}

// PR activity that counts as "the PR changed": opening, reopening and every
// push to its head branch.
const PR_ACTIONS = new Set(['opened', 'reopened', 'synchronize'])

// Empty filter = every branch matches.
function branchMatches(filter: string[], branch: string): boolean {
  return filter.length === 0 || filter.includes(branch)
}

// Match a delivery against one trigger's event + filters. Returns the run
// overrides, or null when the trigger doesn't listen for this delivery.
export function matchGithubEvent(t: Trigger, event: string, payload: GithubPayload): GithubMatch | null {
  if (event !== (t.webhookEvent ?? 'push')) return null

  const common = { event }

  if (event === 'push') {
    // Branch deletions and tag pushes don't run workflows.
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
    }
  }

  if (event === 'pull_request') {
    if (!PR_ACTIONS.has(payload.action ?? '')) return null
    const base = payload.pull_request?.base?.ref ?? ''
    if (!branchMatches(t.webhookBranches, base)) return null
    // The run checks out the PR's code; the filter is about where it's headed.
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
    }
  }

  return null
}
