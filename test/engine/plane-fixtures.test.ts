import { createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'
import { makeTrigger, runsOf } from '../helpers/integration-webhook-suite'
import type { TriggerConfig, TriggerEventConfig } from '../../shared/utils/trigger-form'
import { allOf } from '../helpers/trigger-conditions'

// Real deliveries of one Plane project, captured with KNECHT_DUMP_WEBHOOKS=1.
// Each case names the fixtures a trigger fires on; every other fixture must not.
const DIR = new URL('../fixtures/webhooks/plane/', import.meta.url)
const fixtures = readdirSync(DIR).sort().map((file) => {
  const { body } = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
  return { name: file.replace(/\.json$/, ''), body: JSON.stringify(body), data: body.data }
})

const KNECHT_ACCOUNT = 'ea3eb720-0b5a-4cbc-8a76-23acb222e133'
const SAMUEL = 'a438b84a-6c17-4641-85b4-c40d1fbe335f'
const PLANE_PROJECT = { id: 'fc80d364-b685-4f24-957a-f77456d31d4b', identifier: 'CRA', name: 'Craft CMS' }

// The deliveries carry ids only; these lookups give them the names of the captured project.
const STATE_NAMES: Record<string, string> = { backlog: 'Backlog', unstarted: 'Todo', started: 'In Progress', completed: 'Done', cancelled: 'Cancelled' }
const states = new Map(fixtures.map(({ data }) => [data.state_id as string, { id: data.state_id as string, name: STATE_NAMES[data.state_group as string]!, group: data.state_group as string }]))
const api = vi.hoisted(() => ({ item: {} as Record<string, unknown> }))
vi.mock('../../server/integrations/plane/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/plane/api')>(),
  planeProjectById: async () => PLANE_PROJECT,
  getPlaneWorkItem: async () => api.item,
  listPlaneStates: async () => [...states.values()],
  listPlaneLabels: async () => [{ id: '4e5eff12-3878-4543-a925-2613172a0ff8', name: 'Bug' }],
  listPlaneMembers: async () => [{ id: SAMUEL, displayName: 'Samuel' }, { id: KNECHT_ACCOUNT, displayName: 'Knecht' }],
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { planeConnection } = await import('../../server/integrations/plane/credentials')
const { setProjectLink } = await import('../../server/utils/project-links')
const handler = (await import('../../server/api/plane/webhook.post')).default

const SECRET = 'plane_wh_secret'

const on = (events: TriggerEventConfig[], conditions: TriggerConfig['conditions'] = []): TriggerConfig => ({ kind: 'issue', on: events, conditions })

const CONFIGS = {
  created: on([{ type: 'created' }]),
  createdUrgent: on([{ type: 'created' }], allOf({ priority: ['urgent'] })),
  createdWithoutPriority: on([{ type: 'created' }], allOf({ priority: ['none'] })),
  createdWithBug: on([{ type: 'created' }], allOf({ label: ['Bug'] })),
  createdAssignedToKnecht: on([{ type: 'created' }], allOf({ assignee: ['self'] })),
  assigned: on([{ type: 'assigned' }]),
  labeledBug: on([{ type: 'labeled', values: ['Bug'] }]),
  labeledBugLowercase: on([{ type: 'labeled', values: ['bug'] }]),
  todo: on([{ type: 'state', values: ['Todo'] }]),
  anyUnstarted: on([{ type: 'state', values: ['group:unstarted'] }]),
  anyCompleted: on([{ type: 'state', values: ['group:completed'] }]),
  anyCancelled: on([{ type: 'state', values: ['group:cancelled'] }]),
  anyBacklog: on([{ type: 'state', values: ['group:backlog'] }]),
  anyStarted: on([{ type: 'state', values: ['group:started'] }]),
  unstartedWhileUrgent: on([{ type: 'state', values: ['group:unstarted'] }], allOf({ priority: ['urgent'] })),
}

const fired: Record<keyof typeof CONFIGS, string[]> = Object.fromEntries(Object.keys(CONFIGS).map(k => [k, []])) as never

beforeAll(async () => {
  planeConnection.save({ siteUrl: 'https://app.plane.so', workspaceSlug: 'acme', apiKey: 'k' }, { webhookSecret: SECRET, accountName: 'Knecht', accountId: KNECHT_ACCOUNT })
  const project = makeProject()
  setProjectLink(project.id, 'plane', PLANE_PROJECT.identifier)
  const triggers = Object.entries(CONFIGS).map(([name, config]) => [name, makeTrigger('plane', [project.id], config).id] as const)
  for (const { name, body, data } of fixtures) {
    // What Plane would answer when the work item is fetched right after this delivery.
    api.item = { id: data.id, sequence_id: data.sequence_id, name: data.name, state: data.state_id, labels: data.label_ids, assignees: data.assignee_ids, created_by: data.created_by_id }
    const res = await callRoute(handler, { body, headers: { 'x-plane-event': JSON.parse(body).event, 'x-plane-signature': createHmac('sha256', SECRET).update(body).digest('hex') } })
    expect(res.status, name).toBe(200)
    for (const [config, id] of triggers) {
      if (runsOf(id).length > fired[config as keyof typeof CONFIGS].length) fired[config as keyof typeof CONFIGS].push(name)
    }
  }
})

describe('plane deliveries', () => {
  // A work item created with a label and an assignee arrives as created, updated (labels), updated (assignees).
  it('created fires once per work item and sees what it was born with', () => {
    expect(fired.created).toEqual(['created-2', 'created-3'])
    expect(fired.createdUrgent).toEqual(['created-3'])
    expect(fired.createdWithoutPriority).toEqual(['created-2'])
    expect(fired.createdWithBug).toEqual(['created-3'])
    expect(fired.createdAssignedToKnecht).toEqual(['created-3'])
  })

  it('assigned to Knecht fires on creation and on the assignment delivery, not on assignment to others', () => {
    expect(fired.assigned).toEqual(['created-3', 'updated-3-assignee-knecht'])
  })

  it('labeled fires on creation and on the label delivery, not on removal, and matches exactly', () => {
    expect(fired.labeledBug).toEqual(['created-3', 'updated-3-labels-bug'])
    expect(fired.labeledBugLowercase).toEqual([])
  })

  it('a state fires when reached by name or by group', () => {
    expect(fired.todo).toEqual(['updated-2-state-unstarted', 'updated-3-state-unstarted'])
    expect(fired.anyUnstarted).toEqual(['updated-2-state-unstarted', 'updated-3-state-unstarted'])
    expect(fired.anyCompleted).toEqual(['updated-3-state-completed'])
    expect(fired.anyCancelled).toEqual(['updated-3-state-cancelled'])
  })

  it('a state counts as reached on creation in it and again after closing', () => {
    expect(fired.anyBacklog).toEqual(['created-2', 'updated-3-state-backlog'])
    expect(fired.anyStarted).toEqual(['created-3'])
  })

  it('conditions read the work item at the time of the event', () => {
    expect(fired.unstartedWhileUrgent).toEqual(['updated-3-state-unstarted'])
  })

  it('assignment to others and label removal fire nothing', () => {
    const silent = fixtures.map(f => f.name).filter(name => !Object.values(fired).some(names => names.includes(name)))
    expect(silent).toEqual(['updated-2-assignee-samuel', 'updated-3-labels-removed'])
  })
})
