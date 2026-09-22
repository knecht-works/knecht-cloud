import { describe, expect, it } from 'vitest'
import { githubObject, matchGithubEvent, type GithubPayload } from '../../server/integrations/github/webhook'
import type { TriggerConfig } from '../../shared/utils/trigger-form'
import { allOf, noneOf } from '../helpers/trigger-conditions'

function trigger(overrides: Partial<TriggerConfig>): TriggerConfig {
  return { kind: 'pull_request', on: [{ type: 'opened' }, { type: 'pushed' }], conditions: [], ...overrides }
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
    const labeled = trigger({ on: [{ type: 'labeled', values: ['knecht'] }] })
    expect(fires(labeled, pr('labeled', {}, { label: { name: 'knecht' } }))).toBe(true)
    expect(fires(labeled, pr('labeled', {}, { label: { name: 'other' } }))).toBe(false)
    expect(fires(labeled, pr('opened'))).toBe(false)
    expect(fires(trigger({}), pr('labeled'))).toBe(false)
    const either = trigger({ on: [{ type: 'labeled', values: ['knecht', 'bug'] }] })
    expect(fires(either, pr('labeled', {}, { label: { name: 'bug' } }))).toBe(true)
    expect(fires(either, pr('labeled', {}, { label: { name: 'other' } }))).toBe(false)
  })

  it('keeps a pull request kind away from issue deliveries and the other way round', () => {
    expect(fires(trigger({}), { action: 'opened', issue: { number: 1 } }, 'issues')).toBe(false)
    expect(fires(trigger({ kind: 'issue', on: [{ type: 'opened' }] }), pr('opened'))).toBe(false)
  })

  it('filters on base, head pattern and draft state', () => {
    expect(fires(trigger({ conditions: allOf({ base: ['main', 'staging'] }) }), pr('opened', { base: { ref: 'develop' } }))).toBe(false)
    expect(fires(trigger({ conditions: allOf({ base: ['main', 'staging'] }) }), pr('opened', { base: { ref: 'staging' } }))).toBe(true)
    expect(fires(trigger({ conditions: allOf({ base: ['main', 'releases/*'] }) }), pr('opened', { base: { ref: 'releases/v1' } }))).toBe(true)
    expect(fires(trigger({ conditions: allOf({ base: ['main', 'releases/*'] }) }), pr('opened', { base: { ref: 'hotfix/releases/v1' } }))).toBe(false)
    expect(fires(trigger({ conditions: allOf({ head: ['renovate/*'] }) }), pr('opened', { head: { ref: 'renovate/vue-3.x' } }))).toBe(true)
    expect(fires(trigger({ conditions: allOf({ head: ['renovate/*'] }) }), pr('opened', { head: { ref: 'feat/renovate/x' } }))).toBe(false)
    expect(fires(trigger({ conditions: allOf({ head: ['a.b'] }) }), pr('opened', { head: { ref: 'aXb' } }))).toBe(false)
    expect(fires(trigger({ conditions: allOf({ draft: ['ready'] }) }), pr('opened', { draft: true }))).toBe(false)
    expect(fires(trigger({ conditions: allOf({ draft: ['ready'] }) }), pr('opened'))).toBe(true)
    expect(fires(trigger({ conditions: allOf({ draft: ['draft'] }) }), pr('opened', { draft: true }))).toBe(true)
    expect(fires(trigger({ conditions: allOf({ draft: ['draft'] }) }), pr('opened'))).toBe(false)
  })

  it('filters on author and labels, every filter has to hold', () => {
    const bots = ['renovate[bot]', 'dependabot[bot]']
    expect(fires(trigger({ conditions: noneOf({ author: bots }) }), pr('opened', { user: { login: 'renovate[bot]' } }))).toBe(false)
    expect(fires(trigger({ conditions: noneOf({ author: bots }) }), pr('opened'))).toBe(true)
    expect(fires(trigger({ conditions: allOf({ author: bots }) }), pr('opened'))).toBe(false)
    expect(fires(trigger({ conditions: noneOf({ author: ['*[bot]'] }) }), pr('opened', { user: { login: 'renovate[bot]' } }))).toBe(false)
    expect(fires(trigger({ conditions: allOf({ author: ['*[bot]'] }) }), pr('opened', { user: { login: 'renovate[bot]' } }))).toBe(true)
    expect(fires(trigger({ conditions: allOf({ label: ['bug', 'ui'] }) }), pr('opened', { labels: [{ name: 'ui' }] }))).toBe(true)
    expect(fires(trigger({ conditions: allOf({ label: ['area/*'] }) }), pr('opened', { labels: [{ name: 'area/ui' }] }))).toBe(false)
    expect(fires(trigger({ conditions: allOf({ label: ['bug'], base: ['main'] }) }), pr('opened', { labels: [{ name: 'ui' }] }))).toBe(false)
  })

  it('takes any one group of conditions, and a field more than once in a group', () => {
    const mainOrBots = trigger({ conditions: [...allOf({ base: ['main'], label: ['bug'] }), ...allOf({ author: ['*[bot]'] })] })
    expect(fires(mainOrBots, pr('opened', { labels: [{ name: 'bug' }] }))).toBe(true)
    expect(fires(mainOrBots, pr('opened', { base: { ref: 'develop' }, user: { login: 'renovate[bot]' } }))).toBe(true)
    expect(fires(mainOrBots, pr('opened', { base: { ref: 'develop' }, labels: [{ name: 'bug' }] }))).toBe(false)
    const botsButRenovate = trigger({ conditions: [[...allOf({ author: ['*[bot]'] })[0]!, ...noneOf({ author: ['renovate[bot]'] })[0]!]] })
    expect(fires(botsButRenovate, pr('opened', { user: { login: 'dependabot[bot]' } }))).toBe(true)
    expect(fires(botsButRenovate, pr('opened', { user: { login: 'renovate[bot]' } }))).toBe(false)
  })

  it('tells who is assigned and which labels are missing', () => {
    const ann = { assignees: [{ login: 'ann' }, { login: 'bob' }] }
    expect(fires(trigger({ conditions: allOf({ assignee: ['ann'] }) }), pr('opened', ann))).toBe(true)
    expect(fires(trigger({ conditions: allOf({ assignee: ['ann'] }) }), pr('opened'))).toBe(false)
    expect(fires(trigger({ conditions: noneOf({ assignee: ['ann'] }) }), pr('opened'))).toBe(true)
    expect(fires(trigger({ conditions: noneOf({ label: ['wontfix'] }) }), pr('opened', { labels: [{ name: 'wontfix' }, { name: 'bug' }] }))).toBe(false)
    expect(fires(trigger({ conditions: noneOf({ label: ['wontfix'] }) }), pr('opened', { labels: [{ name: 'bug' }] }))).toBe(true)
  })

  it('fires when an issue is assigned to the configured login', () => {
    const assigned = trigger({ kind: 'issue', on: [{ type: 'assigned', values: ['knecht-works'] }] })
    const issue = { number: 7 }
    expect(fires(assigned, { action: 'assigned', issue, assignee: { login: 'Knecht-Works' } }, 'issues')).toBe(true)
    expect(fires(assigned, { action: 'assigned', issue, assignee: { login: 'ann' } }, 'issues')).toBe(false)
    expect(fires(assigned, { action: 'opened', issue }, 'issues')).toBe(false)
  })
})
