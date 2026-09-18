import { describe, expect, it } from 'vitest'
import { githubObject, matchGithubEvent, type GithubPayload } from '../../server/integrations/github/webhook'
import type { TriggerConfig } from '../../shared/utils/trigger-form'

function trigger(overrides: Partial<TriggerConfig>): TriggerConfig {
  return { kind: 'pull_request', on: [{ type: 'opened' }, { type: 'pushed' }], filters: {}, ...overrides }
}

function pr(action: string, overrides: GithubPayload['pull_request'] = {}, extra: GithubPayload = {}): GithubPayload {
  return { action, pull_request: { number: 1, head: { ref: 'feat' }, base: { ref: 'main' }, user: { login: 'sam' }, ...overrides }, ...extra }
}

describe('matchGithubEvent objects', () => {
  it('a push never matches', () => {
    expect(matchGithubEvent(trigger({}), 'push', { ref: 'refs/heads/main' })).toBeNull()
  })

  it('a pull_request delivery carries the PR as object', () => {
    const match = matchGithubEvent(trigger({}), 'pull_request', {
      action: 'synchronize',
      pull_request: { number: 42, title: 'Add feature', html_url: 'https://x/pull/42', head: { ref: 'feat' }, base: { ref: 'main' }, state: 'open', user: { login: 'sam' }, assignees: [{ login: 'ann' }, { login: 'bob' }], labels: [{ name: 'bug' }, { name: 'ui' }] },
    })
    expect(match!.object).toEqual({ integration: 'github', kind: 'pull_request', key: '42', url: 'https://x/pull/42', title: 'Add feature' })
    expect(match!.inputs).toMatchObject({ status: 'open', assignee: 'ann', labels: 'bug, ui', author: 'sam' })
  })

  it('an issues delivery carries the issue as object', () => {
    const match = matchGithubEvent(trigger({ kind: 'issue', on: [{ type: 'opened' }] }), 'issues', {
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

describe('matchGithubEvent events and filters', () => {
  const fires = (c: TriggerConfig, payload: GithubPayload, event = 'pull_request') => matchGithubEvent(c, event, payload) !== null

  it('fires only on the events the trigger lists', () => {
    const openedOnly = trigger({ on: [{ type: 'opened' }] })
    expect(fires(openedOnly, pr('opened'))).toBe(true)
    expect(fires(openedOnly, pr('reopened'))).toBe(true)
    expect(fires(openedOnly, pr('synchronize'))).toBe(false)
    expect(fires(openedOnly, pr('ready_for_review'))).toBe(false)
    expect(fires(trigger({ on: [{ type: 'ready_for_review' }] }), pr('ready_for_review'))).toBe(true)
  })

  it('fires on the configured pull request label only', () => {
    const labeled = trigger({ on: [{ type: 'labeled', value: 'knecht' }] })
    expect(fires(labeled, pr('labeled', {}, { label: { name: 'knecht' } }))).toBe(true)
    expect(fires(labeled, pr('labeled', {}, { label: { name: 'other' } }))).toBe(false)
    expect(fires(labeled, pr('opened'))).toBe(false)
    expect(fires(trigger({}), pr('labeled'))).toBe(false)
  })

  it('keeps a pull request kind away from issue deliveries and the other way round', () => {
    expect(fires(trigger({}), { action: 'opened', issue: { number: 1 } }, 'issues')).toBe(false)
    expect(fires(trigger({ kind: 'issue', on: [{ type: 'opened' }] }), pr('opened'))).toBe(false)
  })

  it('filters on base, head pattern and draft state', () => {
    expect(fires(trigger({ filters: { base: ['main', 'staging'] } }), pr('opened', { base: { ref: 'develop' } }))).toBe(false)
    expect(fires(trigger({ filters: { base: ['main', 'staging'] } }), pr('opened', { base: { ref: 'staging' } }))).toBe(true)
    expect(fires(trigger({ filters: { head: ['renovate/*'] } }), pr('opened', { head: { ref: 'renovate/vue-3.x' } }))).toBe(true)
    expect(fires(trigger({ filters: { head: ['renovate/*'] } }), pr('opened', { head: { ref: 'feat/renovate/x' } }))).toBe(false)
    expect(fires(trigger({ filters: { head: ['a.b'] } }), pr('opened', { head: { ref: 'aXb' } }))).toBe(false)
    expect(fires(trigger({ filters: { draft: ['ready'] } }), pr('opened', { draft: true }))).toBe(false)
    expect(fires(trigger({ filters: { draft: ['ready'] } }), pr('opened'))).toBe(true)
    expect(fires(trigger({ filters: { draft: ['draft'] } }), pr('opened', { draft: true }))).toBe(true)
    expect(fires(trigger({ filters: { draft: ['draft'] } }), pr('opened'))).toBe(false)
  })

  it('filters on author and labels, every filter has to hold', () => {
    const bots = ['renovate[bot]', 'dependabot[bot]']
    expect(fires(trigger({ filters: { authorNot: bots } }), pr('opened', { user: { login: 'Renovate[bot]' } }))).toBe(false)
    expect(fires(trigger({ filters: { authorNot: bots } }), pr('opened'))).toBe(true)
    expect(fires(trigger({ filters: { author: bots } }), pr('opened'))).toBe(false)
    expect(fires(trigger({ filters: { label: ['bug', 'ui'] } }), pr('opened', { labels: [{ name: 'ui' }] }))).toBe(true)
    expect(fires(trigger({ filters: { label: ['bug'], base: ['main'] } }), pr('opened', { labels: [{ name: 'ui' }] }))).toBe(false)
  })

  it('fires when an issue is assigned to the configured login', () => {
    const assigned = trigger({ kind: 'issue', on: [{ type: 'assigned', value: 'knecht-works' }] })
    const issue = { number: 7 }
    expect(fires(assigned, { action: 'assigned', issue, assignee: { login: 'Knecht-Works' } }, 'issues')).toBe(true)
    expect(fires(assigned, { action: 'assigned', issue, assignee: { login: 'ann' } }, 'issues')).toBe(false)
    expect(fires(assigned, { action: 'opened', issue }, 'issues')).toBe(false)
  })
})
