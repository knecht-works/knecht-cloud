import { describe, expect, it } from 'vitest'
import { githubObject, matchGithubEvent, type GithubTriggerConfig } from '../../server/integrations/github/webhook'

function trigger(overrides: Partial<GithubTriggerConfig>): GithubTriggerConfig {
  return { event: 'pull_request', branches: [], issueActions: ['opened'], issueLabel: null, ...overrides }
}

describe('matchGithubEvent objects', () => {
  it('a push never matches', () => {
    expect(matchGithubEvent(trigger({ event: 'pull_request' }), 'push', { ref: 'refs/heads/main' })).toBeNull()
  })

  it('a pull_request delivery carries the PR as object', () => {
    const match = matchGithubEvent(trigger({ event: 'pull_request' }), 'pull_request', {
      action: 'synchronize',
      pull_request: { number: 42, title: 'Add feature', html_url: 'https://x/pull/42', head: { ref: 'feat' }, base: { ref: 'main' }, state: 'open', user: { login: 'sam' }, assignees: [{ login: 'ann' }, { login: 'bob' }], labels: [{ name: 'bug' }, { name: 'ui' }] },
    })
    expect(match!.object).toEqual({ integration: 'github', kind: 'pull_request', key: '42', url: 'https://x/pull/42', title: 'Add feature' })
    expect(match!.inputs).toMatchObject({ status: 'open', assignee: 'ann', labels: 'bug, ui', author: 'sam' })
  })

  it('an issues delivery carries the issue as object', () => {
    const match = matchGithubEvent(trigger({ event: 'issues' }), 'issues', {
      action: 'opened',
      issue: { number: 7, title: 'Broken', body: 'boom', html_url: 'https://x/issues/7' },
    })
    expect(match!.object).toEqual({ integration: 'github', kind: 'issue', key: '7', url: 'https://x/issues/7', title: 'Broken' })
    expect(match!.inputs).toEqual({ event: 'issues', identifier: '7', title: 'Broken', body: 'boom', url: 'https://x/issues/7', status: '', assignee: '', labels: '', author: '' })
  })

  it('githubObject refuses payloads without a number', () => {
    expect(githubObject('issue', {})).toBeNull()
    expect(githubObject('pull_request', undefined)).toBeNull()
  })
})
