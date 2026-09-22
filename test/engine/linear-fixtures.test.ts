import { createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'
import { makeTrigger, runsOf } from '../helpers/integration-webhook-suite'
import type { TriggerConfig, TriggerEventConfig } from '../../shared/utils/trigger-form'
import { allOf } from '../helpers/trigger-conditions'

// Real deliveries of the CRA team of a Linear workspace, captured with KNECHT_DUMP_WEBHOOKS=1.
// Each case names the fixtures a trigger fires on; every other fixture must not.
const DIR = new URL('../fixtures/webhooks/linear/', import.meta.url)
const fixtures = readdirSync(DIR).sort().map((file) => {
  const { body } = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
  return { name: file.replace(/\.json$/, ''), body: JSON.stringify(body), data: body.data }
})

// The delivery carries the issue Linear would answer when fetched, so the API is served from the fixtures.
const api = vi.hoisted(() => ({ issues: new Map<string, Record<string, unknown>>(), states: new Map<string, { id: string, name: string, type: string }>() }))
vi.mock('../../server/integrations/linear/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/linear/api')>(),
  getLinearIssue: async (id: string) => api.issues.get(id),
  listLinearStates: async () => [...api.states.values()],
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { linearConnection } = await import('../../server/integrations/linear/credentials')
const { setProjectLink } = await import('../../server/utils/project-links')
const handler = (await import('../../server/api/linear/webhook.post')).default

const SECRET = 'lin_wh_secret'
const KNECHT_ACCOUNT = 'a01b5370-e8eb-47ec-85f7-5002aa38aca0'

const on = (events: TriggerEventConfig[], conditions: TriggerConfig['conditions'] = []): TriggerConfig => ({ kind: 'issue', on: events, conditions })

const CONFIGS = {
  created: on([{ type: 'created' }]),
  createdUrgent: on([{ type: 'created' }], allOf({ priority: ['urgent'] })),
  createdWithoutPriority: on([{ type: 'created' }], allOf({ priority: ['none'] })),
  createdWithBug: on([{ type: 'created' }], allOf({ label: ['Bug'] })),
  assigned: on([{ type: 'assigned' }]),
  labeledBug: on([{ type: 'labeled', values: ['Bug'] }]),
  labeledBugLowercase: on([{ type: 'labeled', values: ['bug'] }]),
  inProgress: on([{ type: 'status', values: ['In Progress'] }]),
  anyStarted: on([{ type: 'status', values: ['type:started'] }]),
  anyCompleted: on([{ type: 'status', values: ['type:completed'] }]),
  anyCanceled: on([{ type: 'status', values: ['type:canceled'] }]),
  anyBacklog: on([{ type: 'status', values: ['type:backlog'] }]),
  todo: on([{ type: 'status', values: ['Todo'] }]),
  startedWhileUrgent: on([{ type: 'status', values: ['type:started'] }], allOf({ priority: ['urgent'] })),
}

const fired: Record<keyof typeof CONFIGS, string[]> = Object.fromEntries(Object.keys(CONFIGS).map(k => [k, []])) as never

beforeAll(async () => {
  for (const { data } of fixtures) api.states.set(data.state.id, data.state)
  linearConnection.save({ apiKey: 'k' }, { webhookSecret: SECRET, accountName: 'Knecht', accountId: KNECHT_ACCOUNT })
  const project = makeProject()
  setProjectLink(project.id, 'linear', 'CRA')
  const triggers = Object.entries(CONFIGS).map(([name, config]) => [name, makeTrigger('linear', [project.id], config).id] as const)
  for (const { name, body, data } of fixtures) {
    api.issues.set(data.id, { ...data, labels: { nodes: data.labels } })
    const res = await callRoute(handler, { body, headers: { 'linear-signature': createHmac('sha256', SECRET).update(body).digest('hex') } })
    expect(res.status, name).toBe(200)
    for (const [config, id] of triggers) {
      if (runsOf(id).length > fired[config as keyof typeof CONFIGS].length) fired[config as keyof typeof CONFIGS].push(name)
    }
  }
})

describe('linear deliveries', () => {
  it('created fires once per issue and sees what the issue was born with', () => {
    expect(fired.created).toEqual(['create-CRA-2', 'create-CRA-3'])
    expect(fired.createdUrgent).toEqual(['create-CRA-3'])
    expect(fired.createdWithoutPriority).toEqual(['create-CRA-2'])
    expect(fired.createdWithBug).toEqual(['create-CRA-3'])
  })

  it('assigned to Knecht fires on creation with Knecht as assignee and on a later assignment, not on unassignment or assignment to others', () => {
    expect(fired.assigned).toEqual(['create-CRA-3', 'update-CRA-2-assignee-knecht'])
  })

  it('labeled fires when the label is gained, on creation or later, not when it is removed, and matches exactly', () => {
    expect(fired.labeledBug).toEqual(['create-CRA-3', 'update-CRA-2-labels-bug'])
    expect(fired.labeledBugLowercase).toEqual([])
  })

  it('a status fires when reached by name or by type', () => {
    expect(fired.inProgress).toEqual(['update-CRA-1-state-in-progress', 'update-CRA-3-state-in-progress'])
    expect(fired.anyStarted).toEqual(['update-CRA-1-state-in-progress', 'update-CRA-3-state-in-progress'])
    expect(fired.anyCompleted).toEqual(['update-CRA-1-state-done', 'update-CRA-3-state-done'])
    expect(fired.anyCanceled).toEqual(['update-CRA-1-state-canceled'])
  })

  it('a status is reached again after closing, not by being created in it', () => {
    expect(fired.anyBacklog).toEqual(['update-CRA-3-state-backlog'])
    expect(fired.todo).toEqual(['update-CRA-2-state-todo'])
  })

  it('conditions read the issue at the time of the event', () => {
    expect(fired.startedWhileUrgent).toEqual(['update-CRA-3-state-in-progress'])
  })

  it('priority changes, unassignment, assignment to others and label removal fire nothing', () => {
    const silent = fixtures.map(f => f.name).filter(name => !Object.values(fired).some(names => names.includes(name)))
    expect(silent).toEqual(['update-CRA-2-assignee-removed', 'update-CRA-2-assignee-samuel', 'update-CRA-2-labels-removed', 'update-CRA-2-priority-0', 'update-CRA-2-priority-1'])
  })
})
