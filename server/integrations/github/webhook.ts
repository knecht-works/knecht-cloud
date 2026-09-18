import { z } from 'zod'
import { emptyInputs, type TriggerInputs } from '../../utils/inputs'
import type { SessionObject } from '../../utils/sessions'
import type { TriggerMatch } from '../types'

export const githubTriggerConfigSchema = z.object({
  event: z.enum(['pull_request', 'issues']).default('pull_request'),
  branches: z.array(z.string().min(1)).default([]),
  issueActions: z.array(z.enum(['opened', 'labeled'])).min(1).default(['opened']),
  issueLabel: z.string().min(1).nullable().default(null),
}).refine(
  c => !(c.event === 'issues' && c.issueActions.includes('labeled') && !c.issueLabel),
  'A label is required to trigger on "labeled"',
)

export type GithubTriggerConfig = z.infer<typeof githubTriggerConfigSchema>

export function githubEventLabel(c: GithubTriggerConfig): string {
  if (c.event === 'issues') {
    const parts = c.issueActions.map(a => (a === 'labeled' ? `label "${c.issueLabel ?? '?'}"` : a))
    return `On issues · ${parts.join(', ')}`
  }
  if (!c.branches.length) return `On ${c.event}`
  return `On ${c.event} · base ${c.branches.join(', ')}`
}

export interface GithubPayload {
  action?: string
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

export function matchGithubEvent(c: GithubTriggerConfig, event: string, payload: GithubPayload): TriggerMatch | null {
  if (event !== c.event) return null

  if (event === 'pull_request') {
    if (!PR_ACTIONS.has(payload.action ?? '')) return null
    const base = payload.pull_request?.base?.ref ?? ''
    if (!branchMatches(c.branches, base)) return null
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
    if (!c.issueActions.includes(action as (typeof c.issueActions)[number])) return null
    if (action === 'labeled' && (!c.issueLabel || payload.label?.name !== c.issueLabel)) return null
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
