import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matchGithubEvent, type GithubPayload } from '../../server/integrations/github/webhook'
import type { TriggerConfig, TriggerEventConfig } from '../../shared/utils/trigger-form'
import { allOf, noneOf } from '../helpers/trigger-conditions'

// Real deliveries of knecht-works/test-craftcms, captured with KNECHT_DUMP_WEBHOOKS=1.
// Each case names the fixtures a trigger fires on; every other fixture must not.
const DIR = new URL('../fixtures/webhooks/github/', import.meta.url)
const fixtures = readdirSync(DIR).map((file) => {
  const { headers, body } = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
  return { name: file.replace(/\.json$/, ''), event: headers['x-github-event'] as string, payload: body as GithubPayload }
})

const issue = (on: TriggerEventConfig[], conditions: TriggerConfig['conditions'] = []): TriggerConfig => ({ kind: 'issue', on, conditions })
const pr = (on: TriggerEventConfig[], conditions: TriggerConfig['conditions'] = []): TriggerConfig => ({ kind: 'pull_request', on, conditions })

function firing(config: TriggerConfig): string[] {
  return fixtures.filter(f => matchGithubEvent(config, f.event, f.payload)).map(f => f.name).sort()
}

describe('github issue deliveries', () => {
  it('opened fires once per issue, not on reopened or the deliveries GitHub sends around it', () => {
    expect(firing(issue([{ type: 'opened' }]))).toEqual(['issues-opened-32', 'issues-opened-33', 'issues-opened-36'])
  })

  it('opened already carries the labels and assignees the issue was created with', () => {
    expect(firing(issue([{ type: 'opened' }], allOf({ label: ['enhancement'] })))).toEqual(['issues-opened-33', 'issues-opened-36'])
    expect(firing(issue([{ type: 'opened' }], allOf({ assignee: ['samuelreichor'] })))).toEqual(['issues-opened-33', 'issues-opened-36'])
  })

  // Issues 33 and 36 were created with labels and an assignee: GitHub sent assigned, opened and
  // labeled as separate deliveries and each matches on its own. That they start one run is
  // fireTrigger's job (test/engine/github-fixtures.test.ts).
  it('every delivery of a creation matches on its own', () => {
    expect(firing(issue([{ type: 'opened' }, { type: 'labeled', values: ['enhancement'] }])))
      .toEqual(['issues-labeled-32-enhancement', 'issues-labeled-33-enhancement', 'issues-labeled-36-enhancement', 'issues-opened-32', 'issues-opened-33', 'issues-opened-36'])
  })

  it('labeled fires on the delivery of that exact label', () => {
    expect(firing(issue([{ type: 'labeled', values: ['bug'] }]))).toEqual(['issues-labeled-32-bug', 'issues-labeled-36-bug'])
    expect(firing(issue([{ type: 'labeled', values: ['Feature/API'] }]))).toEqual(['issues-labeled-32-feature-api'])
    expect(firing(issue([{ type: 'labeled', values: ['feature/api'] }]))).toEqual([])
  })

  it('assigned fires on the login, whatever its case', () => {
    expect(firing(issue([{ type: 'assigned', values: ['samuelreichor'] }]))).toEqual(['issues-assigned-32', 'issues-assigned-33', 'issues-assigned-36'])
    expect(firing(issue([{ type: 'assigned', values: ['SamuelReichor'] }]))).toEqual(['issues-assigned-32', 'issues-assigned-33', 'issues-assigned-36'])
    expect(firing(issue([{ type: 'assigned', values: ['someone-else'] }]))).toEqual([])
  })

  it('author and label conditions read the issue', () => {
    expect(firing(issue([{ type: 'opened' }], allOf({ author: ['samuelreichor'] })))).toEqual(['issues-opened-32', 'issues-opened-33', 'issues-opened-36'])
    expect(firing(issue([{ type: 'opened' }], noneOf({ author: ['samuelreichor'] })))).toEqual([])
    expect(firing(issue([{ type: 'labeled', values: ['Feature/API'] }], allOf({ label: ['bug'] })))).toEqual(['issues-labeled-32-feature-api'])
  })
})

describe('github pull request deliveries', () => {
  it('opened fires on opened and reopened', () => {
    expect(firing(pr([{ type: 'opened' }]))).toEqual(['pull_request-opened-34', 'pull_request-opened-35', 'pull_request-reopened-28'])
  })

  it('the draft condition tells a draft from a ready pull request', () => {
    expect(firing(pr([{ type: 'opened' }], allOf({ draft: ['draft'] })))).toEqual(['pull_request-opened-34'])
    expect(firing(pr([{ type: 'opened' }], allOf({ draft: ['ready'] })))).toEqual(['pull_request-opened-35', 'pull_request-reopened-28'])
  })

  it('ready for review fires when a draft is marked ready, never when a PR becomes a draft', () => {
    expect(firing(pr([{ type: 'ready_for_review' }]))).toEqual(['pull_request-ready_for_review-28', 'pull_request-ready_for_review-34'])
  })

  it('pushed fires on the pull request delivery of a push, not on the push itself', () => {
    expect(firing(pr([{ type: 'pushed' }]))).toEqual(['pull_request-synchronize-34'])
    const push = fixtures.find(f => f.name === 'pull_request-synchronize-34')!
    expect(matchGithubEvent(pr([{ type: 'pushed' }]), push.event, push.payload)!.branch).toBe('fix/issue-24-dependency-security-updates')
  })

  it('labeled fires on the delivery of that label', () => {
    expect(firing(pr([{ type: 'labeled', values: ['bug'] }]))).toEqual(['pull_request-labeled-35-bug'])
  })

  it('opened already carries the assignees the PR was created with', () => {
    expect(firing(pr([{ type: 'opened' }], allOf({ assignee: ['samuelreichor'] })))).toEqual(['pull_request-opened-35'])
  })

  it('base and head conditions take patterns', () => {
    const onChange = pr([{ type: 'opened' }, { type: 'pushed' }])
    expect(firing({ ...onChange, conditions: allOf({ head: ['fix/*'] }) })).toEqual(['pull_request-opened-34', 'pull_request-synchronize-34'])
    expect(firing({ ...onChange, conditions: allOf({ base: ['main'] }) })).toEqual(['pull_request-opened-34', 'pull_request-opened-35', 'pull_request-reopened-28', 'pull_request-synchronize-34'])
    expect(firing({ ...onChange, conditions: allOf({ base: ['develop'] }) })).toEqual([])
  })
})

describe('github deliveries no trigger fires on', () => {
  it('lists every delivery that fires nothing, whatever the trigger', () => {
    const labels = ['bug', 'enhancement', 'documentation', 'Feature/API']
    const anything = [
      issue([{ type: 'opened' }]),
      issue([{ type: 'labeled', values: labels }]),
      issue([{ type: 'assigned', values: ['samuelreichor'] }]),
      pr([{ type: 'opened' }]),
      pr([{ type: 'ready_for_review' }]),
      pr([{ type: 'pushed' }]),
      pr([{ type: 'labeled', values: labels }]),
    ]
    const silent = fixtures.filter(f => anything.every(c => !matchGithubEvent(c, f.event, f.payload))).map(f => f.name).sort()
    expect(silent).toEqual([
      'issues-closed-31',
      'issues-closed-32',
      'issues-field_added-33',
      'issues-field_added-33-2',
      'issues-field_added-36',
      'issues-field_added-36-2',
      'issues-field_removed-33',
      'issues-field_removed-33-2',
      'issues-reopened-32',
      'issues-typed-33',
      'issues-typed-36',
      'issues-unlabeled-32-enhancement',
      'issues-untyped-33',
      'pull_request-assigned-35',
      'pull_request-closed-28',
      'pull_request-converted_to_draft-28',
      'pull_request-review_request_removed-35',
      'pull_request-review_requested-34',
      'pull_request-review_requested-35',
      'pull_request-unassigned-35',
      'pull_request-unlabeled-35-bug',
      'pull_request-unlabeled-35-documentation',
      'push-23f7cdd',
    ])
  })
})
