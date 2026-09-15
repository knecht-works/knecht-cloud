import { describe, expect, it } from 'vitest'
import type { Trigger } from '../../server/db/schema'
import { githubObject, matchGithubEvent } from '../../server/utils/github-webhook'

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
    expect(match!.inputs).toEqual({ event: 'push', identifier: 'abcdef1', title: 'fix', body: '', url: 'https://x/c', status: '', assignee: '', labels: '', author: '' })
  })

  it('a pull_request delivery carries the PR as object', () => {
    const match = matchGithubEvent(trigger({ webhookEvent: 'pull_request' }), 'pull_request', {
      action: 'synchronize',
      pull_request: { number: 42, title: 'Add feature', html_url: 'https://x/pull/42', head: { ref: 'feat' }, base: { ref: 'main' }, state: 'open', user: { login: 'sam' }, assignees: [{ login: 'ann' }, { login: 'bob' }], labels: [{ name: 'bug' }, { name: 'ui' }] },
    })
    expect(match!.object).toEqual({ integration: 'github', kind: 'pull_request', key: '42', url: 'https://x/pull/42', title: 'Add feature' })
    expect(match!.inputs).toMatchObject({ status: 'open', assignee: 'ann', labels: 'bug, ui', author: 'sam' })
  })

  it('an issues delivery carries the issue as object', () => {
    const match = matchGithubEvent(trigger({ webhookEvent: 'issues' }), 'issues', {
      action: 'opened',
      issue: { number: 7, title: 'Broken', body: 'boom', html_url: 'https://x/issues/7' },
    })
    expect(match!.object).toEqual({ integration: 'github', kind: 'issue', key: '7', url: 'https://x/issues/7', title: 'Broken' })
    expect(match!.inputs).toEqual({ event: 'issues', identifier: '7', title: 'Broken', body: 'boom', url: 'https://x/issues/7', status: '', assignee: '', labels: '', author: '' })
  })

  it('githubObject refuses payloads without a number', () => {
    expect(githubObject('issue', { issue: {} })).toBeNull()
    expect(githubObject('pull_request', {})).toBeNull()
  })
})
