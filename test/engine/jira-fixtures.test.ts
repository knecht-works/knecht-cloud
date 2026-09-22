import { createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'
import { makeTrigger, runsOf } from '../helpers/integration-webhook-suite'
import type { TriggerConfig, TriggerEventConfig } from '../../shared/utils/trigger-form'
import { allOf, noneOf } from '../helpers/trigger-conditions'

// Status ids of the captured site, by category; the changelog carries only ids.
const STATUS_CATEGORIES: Record<string, string> = { 10072: 'new', 10037: 'indeterminate', 10038: 'done' }
vi.mock('../../server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/jira/api')>(),
  getJiraStatusCategory: async (id: string) => STATUS_CATEGORIES[id] ?? null,
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { jiraConnection } = await import('../../server/integrations/jira/credentials')
const { setProjectLink } = await import('../../server/utils/project-links')
const handler = (await import('../../server/api/jira/webhook.post')).default

const SECRET = 'jira_wh_secret'
const KNECHT_ACCOUNT = '712020:6e6c010f-5693-48ea-9049-18a3f7ce3087'

// Real deliveries of the CC project on a Jira Cloud site, captured with KNECHT_DUMP_WEBHOOKS=1.
// Each case names the fixtures a trigger fires on; every other fixture must not.
const DIR = new URL('../fixtures/webhooks/jira/', import.meta.url)
const fixtures = readdirSync(DIR).sort().map(file => ({ name: file.replace(/\.json$/, ''), body: JSON.stringify(JSON.parse(readFileSync(new URL(file, DIR), 'utf8')).body) }))

const on = (events: TriggerEventConfig[], conditions: TriggerConfig['conditions'] = []): TriggerConfig => ({ kind: 'issue', on: events, conditions })

const CONFIGS = {
  created: on([{ type: 'created' }]),
  createdWithLabel: on([{ type: 'created' }], allOf({ label: ['bug'] })),
  createdAssignedToKnecht: on([{ type: 'created' }], allOf({ assignee: ['self'] })),
  createdNotAssignedToKnecht: on([{ type: 'created' }], noneOf({ assignee: ['self'] })),
  createdTask: on([{ type: 'created' }], allOf({ issueType: ['Task'] })),
  createdBug: on([{ type: 'created' }], allOf({ issueType: ['Bug'] })),
  assigned: on([{ type: 'assigned' }]),
  labeledEnhancement: on([{ type: 'labeled', values: ['enhancement'] }]),
  labeledBug: on([{ type: 'labeled', values: ['bug'] }]),
  labeledFeatureApi: on([{ type: 'labeled', values: ['Feature-API.'] }]),
  labeledFeatureApiLowercase: on([{ type: 'labeled', values: ['feature-api.'] }]),
  assignedBug: on([{ type: 'assigned' }], allOf({ issueType: ['Bug'] })),
  inProgress: on([{ type: 'status', values: ['In Progress'] }]),
  anyInProgress: on([{ type: 'status', values: ['category:indeterminate'] }]),
  anyDone: on([{ type: 'status', values: ['category:done'] }]),
  done: on([{ type: 'status', values: ['Done'] }]),
  anyToDo: on([{ type: 'status', values: ['category:new'] }]),
  createdOrInProgressWhileEnhancement: on([{ type: 'created' }, { type: 'status', values: ['category:indeterminate'] }], allOf({ label: ['enhancement'] })),
}

const fired: Record<keyof typeof CONFIGS, string[]> = Object.fromEntries(Object.keys(CONFIGS).map(k => [k, []])) as never

beforeAll(async () => {
  jiraConnection.save({ siteUrl: 'https://acme.atlassian.net', email: 'knecht@acme.test', apiToken: 't' }, { webhookSecret: SECRET, accountName: 'Knecht', accountId: KNECHT_ACCOUNT })
  const project = makeProject()
  setProjectLink(project.id, 'jira', 'CC')
  const triggers = Object.entries(CONFIGS).map(([name, config]) => [name, makeTrigger('jira', [project.id], config).id] as const)
  for (const { name, body } of fixtures) {
    const res = await callRoute(handler, { body, headers: { 'x-hub-signature': `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}` } })
    expect(res.status, name).toBe(200)
    for (const [config, id] of triggers) {
      if (runsOf(id).length > fired[config as keyof typeof CONFIGS].length) fired[config as keyof typeof CONFIGS].push(name)
    }
  }
})

describe('jira deliveries', () => {
  it('created fires once per issue', () => {
    expect(fired.created).toEqual(['issue_created-CC-17', 'issue_created-CC-18', 'issue_created-CC-19'])
  })

  // Labels and the assignee set on creation are on the issue, not in the changelog.
  it('created sees the labels, assignee and type the issue was born with', () => {
    expect(fired.createdWithLabel).toEqual(['issue_created-CC-18'])
    expect(fired.createdAssignedToKnecht).toEqual(['issue_created-CC-18'])
    expect(fired.createdNotAssignedToKnecht).toEqual(['issue_created-CC-17', 'issue_created-CC-19'])
    expect(fired.createdTask).toEqual(['issue_created-CC-17', 'issue_created-CC-18'])
    expect(fired.createdBug).toEqual(['issue_created-CC-19'])
  })

  it('assigned to Knecht fires on creation with Knecht as assignee and on a later assignment, not on unassignment', () => {
    expect(fired.assigned).toEqual(['issue_created-CC-18', 'issue_updated-CC-19-assignee-knecht'])
    expect(fired.assignedBug).toEqual(['issue_updated-CC-19-assignee-knecht'])
  })

  it('labeled fires when the label is gained, on creation or later, not when it is removed', () => {
    expect(fired.labeledEnhancement).toEqual(['issue_created-CC-18', 'issue_updated-CC-18-labels-enhancement'])
    expect(fired.labeledBug).toEqual(['issue_created-CC-18'])
  })

  it('labels match exactly', () => {
    expect(fired.labeledFeatureApi).toEqual(['issue_updated-CC-19-labels-feature-api'])
    expect(fired.labeledFeatureApiLowercase).toEqual([])
  })

  it('a status fires when reached by name or by category', () => {
    expect(fired.inProgress).toEqual(['issue_updated-CC-18-status-in-progress'])
    expect(fired.anyInProgress).toEqual(['issue_updated-CC-18-status-in-progress'])
    expect(fired.anyDone).toEqual(['issue_updated-CC-18-status-done'])
    expect(fired.done).toEqual(['issue_updated-CC-18-status-done'])
  })

  // The reopen changelog lists the resolution change before the status change.
  it('a status is reached again after reopening, not by being created in it', () => {
    expect(fired.anyToDo).toEqual(['issue_updated-CC-18-status-in-planning'])
  })

  it('conditions apply to every event of the trigger', () => {
    expect(fired.createdOrInProgressWhileEnhancement).toEqual(['issue_created-CC-18', 'issue_updated-CC-18-status-in-progress'])
  })
})
