import { describe, expect, it } from 'vitest'
import type { Trigger } from '../../server/db/schema'
import { githubObject, matchGithubEvent } from '../../server/utils/github-webhook'

// The webhook matcher's object extraction (ADR 0006): PR and issue
// deliveries carry the object their run's session belongs to; pushes have
// none.

function trigger(overrides: Partial<Trigger>): Trigger {
  return {
    webhookEvent: 'push',
    webhookBranches: [],
    issueActions: ['opened'],
    issueLabel: null,
    ...overrides,
  } as Trigger
}

describe('matchGithubEvent objects', () => {
  it('a push matches with no object', () => {
    const match = matchGithubEvent(trigger({ webhookEvent: 'push' }), 'push', {
      ref: 'refs/heads/main',
      after: 'abcdef1234',
      head_commit: { message: 'fix', url: 'https://x/c' },
    })
    expect(match).not.toBeNull()
    expect(match!.object).toBeNull()
  })

  it('a pull_request delivery carries the PR as object', () => {
    const match = matchGithubEvent(trigger({ webhookEvent: 'pull_request' }), 'pull_request', {
      action: 'synchronize',
      pull_request: { number: 42, title: 'Add feature', html_url: 'https://x/pull/42', head: { ref: 'feat' }, base: { ref: 'main' } },
    })
    expect(match!.object).toEqual({ kind: 'pull_request', number: 42, url: 'https://x/pull/42', title: 'Add feature' })
  })

  it('an issues delivery carries the issue as object', () => {
    const match = matchGithubEvent(trigger({ webhookEvent: 'issues' }), 'issues', {
      action: 'opened',
      issue: { number: 7, title: 'Broken', body: 'boom', html_url: 'https://x/issues/7' },
    })
    expect(match!.object).toEqual({ kind: 'issue', number: 7, url: 'https://x/issues/7', title: 'Broken' })
  })

  it('githubObject refuses payloads without a number', () => {
    expect(githubObject('issue', { issue: {} })).toBeNull()
    expect(githubObject('pull_request', {})).toBeNull()
  })
})
