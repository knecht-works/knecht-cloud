import { createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'
import { makeWorkflow, triggerSourceOf } from '../helpers/integration-webhook-suite'
import type { TriggerConfig, TriggerEventConfig } from '../../shared/utils/trigger-form'

vi.mock('../../server/utils/github-app', () => ({ addCommentReaction: async () => {}, createIssueComment: async () => ({ url: '' }) }))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { saveGithubAppCredentials } = await import('../../server/utils/github-credentials')
const { db, schema } = await import('../../server/db')
const { eq } = await import('drizzle-orm')
const handler = (await import('../../server/api/github/webhook.post')).default

const SECRET = 'whsec-test'

// The same deliveries as in test/unit/github-fixtures.test.ts, here through the route and
// fireTrigger: what matters is how many runs one action starts, not which delivery matched.
const DIR = new URL('../fixtures/webhooks/github/', import.meta.url)
const fixtures = readdirSync(DIR).sort().map((file) => {
  const { headers, body } = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
  return { name: file.replace(/\.json$/, ''), event: headers['x-github-event'] as string, body: JSON.stringify(body), repositoryId: body.repository?.id as number }
})

const issue = (event: TriggerEventConfig): TriggerConfig => ({ kind: 'issue', event, conditions: [] })
const pr = (event: TriggerEventConfig): TriggerConfig => ({ kind: 'pull_request', event, conditions: [] })

// Each entry is one workflow with one trigger per event: they share the per-version check.
const CONFIGS = {
  issueAnything: [issue({ type: 'opened' }), issue({ type: 'labeled', values: ['bug', 'enhancement', 'Feature/API'] }), issue({ type: 'assigned', values: ['samuelreichor'] })],
  issueLabels: [issue({ type: 'labeled', values: ['bug', 'enhancement'] })],
  issueAssigned: [issue({ type: 'assigned', values: ['samuelreichor'] })],
  prAnything: [pr({ type: 'opened' }), pr({ type: 'ready_for_review' }), pr({ type: 'pushed' }), pr({ type: 'labeled', values: ['bug', 'documentation'] })],
}

const fired: Record<keyof typeof CONFIGS, string[]> = Object.fromEntries(Object.keys(CONFIGS).map(k => [k, []])) as never

beforeAll(async () => {
  saveGithubAppCredentials({ appId: '1', slug: 'knecht-test', clientId: 'c', clientSecret: 'x', privateKey: 'x', webhookSecret: SECRET })
  const project = makeProject({ repoId: String(fixtures[0]!.repositoryId) })
  const workflows = Object.entries(CONFIGS).map(([name, configs]) => {
    const workflowId = makeWorkflow().id
    for (const config of configs) {
      db.insert(schema.triggers).values({ ...triggerSourceOf('github'), workflowId, projectIds: [project.id], config: { ...config } }).run()
    }
    return [name, workflowId] as const
  })
  for (const { name, event, body } of fixtures) {
    const res = await callRoute(handler, { body, headers: { 'x-github-event': event, 'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}` } })
    expect(res.status, name).toBe(200)
    for (const [config, workflowId] of workflows) {
      const runs = db.select().from(schema.runs).where(eq(schema.runs.workflowId, workflowId)).all()
      if (runs.length > fired[config as keyof typeof CONFIGS].length) fired[config as keyof typeof CONFIGS].push(name)
    }
  }
})

describe('github deliveries through fireTrigger', () => {
  // Issue 33 was created with a label and an assignee, issue 36 with two labels and an assignee:
  // GitHub sent typed, assigned, opened and labeled as separate deliveries, all with the creation's updated_at.
  it('a creation starts one run however many of its deliveries match', () => {
    expect(fired.issueAnything.filter(n => n.includes('-33'))).toEqual(['issues-assigned-33'])
    expect(fired.issueAnything.filter(n => n.includes('-36'))).toEqual(['issues-assigned-36'])
    expect(fired.issueLabels.filter(n => n.includes('-36'))).toEqual(['issues-labeled-36-bug'])
    expect(fired.issueAssigned.filter(n => n.includes('-36'))).toEqual(['issues-assigned-36'])
  })

  // Issue 32 got bug and enhancement in one save: two labeled deliveries, one updated_at.
  it('labels set together start one run, a label set later its own', () => {
    expect(fired.issueLabels.filter(n => n.includes('-32'))).toEqual(['issues-labeled-32-bug'])
    expect(fired.issueAnything.filter(n => n.includes('-32'))).toEqual(['issues-assigned-32', 'issues-labeled-32-bug', 'issues-labeled-32-feature-api', 'issues-opened-32', 'issues-reopened-32'])
  })

  it('a pull request created with labels starts one run, later pushes and reviews their own', () => {
    expect(fired.prAnything.filter(n => n.includes('-35'))).toEqual(['pull_request-labeled-35-bug'])
    expect(fired.prAnything.filter(n => n.includes('-34'))).toEqual(['pull_request-opened-34', 'pull_request-ready_for_review-34', 'pull_request-synchronize-34'])
    expect(fired.prAnything.filter(n => n.includes('-28'))).toEqual(['pull_request-ready_for_review-28', 'pull_request-reopened-28'])
  })
})
