import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { getSessionRow, makeProject, makeRun } from '../helpers/db'
import { describeIntegrationWebhook, makeTrigger, runsOf, type WebhookRequest } from '../helpers/integration-webhook-suite'
import type { TriggerConfig } from '../../shared/utils/trigger-form'
import { allOf } from '../helpers/trigger-conditions'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'

const KNECHT_ACCOUNT = 'knecht-account-id'

const api = vi.hoisted(() => ({
  projects: [] as { id: string, identifier: string, name: string }[],
  comments: [] as { projectId: string, workItemId: string, html: string }[],
  assignees: new Map<string, string[]>(),
  assigned: [] as string[][],
  fetched: {
    id: '77',
    comment_html: '',
    actor: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
  },
}))
const workItem = vi.hoisted(() => (id: string) => ({
  id,
  sequence_id: 12,
  name: 'Login broken',
  description_html: '<p>It fails on <strong>submit</strong>.</p>',
  state: 's-todo',
  labels: ['l-knecht', 'l-bug'],
  assignees: api.assignees.get(id) ?? [],
  created_by: 'user-1',
}))
vi.mock('../../server/integrations/plane/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/plane/api')>(),
  listPlaneProjects: async () => api.projects,
  planeProjectById: async (id: string) => api.projects.find(p => p.id === id),
  planeProjectByIdentifier: async (identifier: string) => {
    const project = api.projects.find(p => p.identifier === identifier)
    if (!project) throw new Error('not found')
    return project
  },
  // Work item ids carry their project's identifier, so a probe of the wrong project fails like Plane's 404.
  getPlaneWorkItem: async (projectId: string, id: string) => {
    const project = api.projects.find(p => p.id === projectId)
    if (!project || id !== `wi-${project.identifier}`) throw new Error('not found')
    return workItem(id)
  },
  getPlaneWorkItemByKey: async (key: string) => workItem(`wi-${key.replace(/-\d+$/, '')}`),
  listPlaneStates: async () => [
    { id: 's-todo', name: 'Todo', group: 'unstarted' },
    { id: 's-progress', name: 'In Progress', group: 'started' },
    { id: 's-review', name: 'In Review', group: 'started' },
    { id: 's-done', name: 'Done', group: 'completed' },
  ],
  listPlaneLabels: async () => [{ id: 'l-knecht', name: 'knecht' }, { id: 'l-bug', name: 'bug' }],
  listPlaneMembers: async () => [{ id: 'user-1', displayName: 'Ann Example' }, { id: 'user-2', displayName: 'Bob' }, { id: KNECHT_ACCOUNT, displayName: 'Knecht' }],
  getPlaneComment: async () => api.fetched,
  addPlaneComment: async (projectId: string, workItemId: string, html: string) => {
    api.comments.push({ projectId, workItemId, html })
  },
  updatePlaneWorkItem: async (_projectId: string, workItemId: string, patch: { assignees?: string[] }) => {
    if (!patch.assignees) return
    api.assigned.push(patch.assignees)
    api.assignees.set(workItemId, patch.assignees)
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { plane } = await import('../../server/integrations/plane')
const { planeConnection } = await import('../../server/integrations/plane/credentials')
const { resolveSession } = await import('../../server/utils/sessions')
const { setProjectLink } = await import('../../server/utils/project-links')
const handler = (await import('../../server/api/plane/webhook.post')).default

const SECRET = 'plane_wh_secret'

function request(payload: { event: string }, secret = SECRET): WebhookRequest {
  const body = JSON.stringify(payload)
  return {
    body,
    headers: {
      'x-plane-event': payload.event,
      'x-plane-signature': createHmac('sha256', secret).update(body).digest('hex'),
    },
  }
}

function deliver(payload: { event: string }) {
  return callRoute(handler, request(payload))
}

let keyN = 0
function makePlaneProject() {
  const project = makeProject()
  const identifier = `P${++keyN}`
  const planeId = `pp-${identifier}`
  api.projects.push({ id: planeId, identifier, name: `Project ${identifier}` })
  setProjectLink(project.id, 'plane', identifier)
  return { ...project, identifier, planeId }
}

function makePlaneTrigger(projectId: number, config: TriggerConfig) {
  return makeTrigger('plane', [projectId], config)
}

type PlaneProject = { identifier: string, planeId: string }

function item(project: PlaneProject, overrides: Record<string, unknown> = {}) {
  return {
    id: `wi-${project.identifier}`,
    name: 'Login broken',
    sequence_id: 12,
    project_id: project.planeId,
    state_id: 's-todo',
    label_ids: ['l-knecht', 'l-bug'],
    assignee_ids: [],
    created_by_id: 'user-1',
    ...overrides,
  }
}

function created(project: PlaneProject, overrides: Record<string, unknown> = {}) {
  return { event: 'workitem.created', entity_id: `wi-${project.identifier}`, data: item(project, overrides), previous_attributes: {} }
}

function updated(project: PlaneProject, previous: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { event: 'workitem.updated', entity_id: `wi-${project.identifier}`, data: item(project, overrides), previous_attributes: previous }
}

function commented(project: PlaneProject, fetched: typeof api.fetched) {
  const commentId = fetched.id
  api.fetched = fetched
  return {
    event: 'workitem.comment.created',
    entity_id: `wi-${project.identifier}`,
    data: { id: `wi-${project.identifier}`, name: 'Login broken', comment: { id: commentId, actor_id: 'user-1', issue_id: `wi-${project.identifier}` } },
    previous_attributes: {},
  }
}

describeIntegrationWebhook<ReturnType<typeof makePlaneProject>, { event: string }>({
  integration: plane,
  handler,
  configure: () => planeConnection.save({ siteUrl: 'https://app.plane.so', workspaceSlug: 'acme', apiKey: 'k' }, { webhookSecret: SECRET, accountName: 'Knecht', accountId: KNECHT_ACCOUNT }),
  request,
  makeProject: makePlaneProject,
  unknownProject: () => {
    api.projects.push({ id: 'pp-NOPE', identifier: 'NOPE', name: 'Unlinked' })
    return created({ identifier: 'NOPE', planeId: 'pp-NOPE' })
  },
  object: project => ({ integration: 'plane', kind: 'issue', key: `${project.identifier}-12` }),
  created: {
    config: { kind: 'issue', on: [{ type: 'created' }], conditions: [] },
    delivery: project => created(project),
    run: project => ({
      trigger: 'plane',
      branch: 'main',
      inputs: {
        event: 'issue',
        identifier: `${project.identifier}-12`,
        title: 'Login broken',
        body: 'It fails on **submit**.',
        url: `https://app.plane.so/acme/browse/${project.identifier}-12/`,
        status: 'Todo',
        assignee: '',
        labels: 'knecht, bug',
        author: 'Ann Example',
      },
    }),
    session: project => ({
      objectIntegration: 'plane',
      objectKind: 'issue',
      objectKey: `${project.identifier}-12`,
      objectTitle: 'Login broken',
      objectUrl: `https://app.plane.so/acme/browse/${project.identifier}-12/`,
    }),
  },
  labeled: {
    config: { kind: 'issue', on: [{ type: 'labeled', values: ['knecht'] }], conditions: [] },
    notGained: project => [
      updated(project, { label_ids: ['l-knecht'] }, { label_ids: ['l-knecht', 'l-bug'] }),
      updated(project, { label_ids: [] }, { label_ids: ['l-bug'] }),
      updated(project, { name: 'old' }, { label_ids: ['l-knecht'] }),
    ],
    gained: project => updated(project, { label_ids: ['l-bug'] }, { label_ids: ['l-bug', 'l-knecht'] }),
  },
  filters: [{
    config: { kind: 'issue', on: [{ type: 'created' }], conditions: [] },
    delivery: project => created(project, { assignee_ids: [KNECHT_ACCOUNT], priority: 'high' }),
    values: { state: 'Todo', assignee: 'self', label: 'bug', priority: 'high' },
  }],
  closed: project => updated(project, { state_id: 's-todo' }, { state_id: 's-done' }),
  reopened: project => updated(project, { state_id: 's-done' }, { state_id: 's-todo' }),
  comment: {
    mention: project => commented(project, {
      id: '77',
      comment_html: `<p><mention-component entity_identifier="${KNECHT_ACCOUNT}" entity_name="user_mention"></mention-component> please fix the login</p>`,
      actor: 'user-1',
      created_at: '2026-01-01T00:00:00Z',
    }),
    fromSelf: project => commented(project, { id: '79', comment_html: '<p>@knecht I am Knecht</p>', actor: KNECHT_ACCOUNT, created_at: '' }),
    withoutMention: project => commented(project, { id: '80', comment_html: '<p>just chatting</p>', actor: 'user-1', created_at: '' }),
    replyCount: project => api.comments.filter(c => c.projectId === project.planeId && c.workItemId === `wi-${project.identifier}`).length,
  },
  recorded: {
    status: planeConnection.status,
    createdSummary: project => `workitem.created ${project.identifier}-12`,
  },
})

describe('plane webhook route, vendor specifics', () => {
  it('fires on a work item created with the label or the assignment already set, not in the state', async () => {
    const project = makePlaneProject()
    const labeled = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'labeled', values: ['knecht'] }], conditions: [] })
    const transitioned = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'state', values: ['In Progress'] }], conditions: [] })
    const assigned = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'assigned' }], conditions: [] })

    await deliver(created(project, { label_ids: ['l-bug'] }))
    expect(runsOf(labeled.id)).toHaveLength(0)
    expect(runsOf(transitioned.id)).toHaveLength(0)
    expect(runsOf(assigned.id)).toHaveLength(0)

    await deliver(created(project, { state_id: 's-progress', assignee_ids: [KNECHT_ACCOUNT] }))
    expect(runsOf(labeled.id)).toHaveLength(1)
    expect(runsOf(transitioned.id)).toHaveLength(0)
    expect(runsOf(assigned.id)).toHaveLength(1)
  })

  it('fires on a transition to the configured state', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'state', values: ['In Progress'] }], conditions: [] })
    await deliver(updated(project, { state_id: 's-todo' }, { state_id: 's-done' }))
    await deliver(updated(project, { name: 'old' }, { state_id: 's-progress' }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, { state_id: 's-todo' }, { state_id: 's-progress' }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires on a state group only when the work item enters it', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'state', values: ['group:started'] }], conditions: [] })
    await deliver(updated(project, { state_id: 's-progress' }, { state_id: 's-review' }))
    await deliver(updated(project, { state_id: 's-todo' }, { state_id: 's-done' }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, { state_id: 's-todo' }, { state_id: 's-review' }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires once when any of several events matches', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'labeled', values: ['knecht'] }, { type: 'assigned' }], conditions: [] })
    await deliver(updated(project, { label_ids: [], assignee_ids: [] }, { label_ids: ['l-knecht'], assignee_ids: [KNECHT_ACCOUNT] }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('holds back work items its label and priority filters exclude', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'created' }], conditions: allOf({ label: ['knecht'], priority: ['urgent', 'high'] }) })
    await deliver(created(project, { label_ids: ['l-bug'], priority: 'high' }))
    await deliver(created(project, { priority: 'low' }))
    await deliver(created(project))
    await deliver(created(project, { priority: 'High' }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(created(project, { priority: 'high' }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires when the work item is assigned to the connection account', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'assigned' }], conditions: [] })
    await deliver(updated(project, { assignee_ids: [] }, { assignee_ids: ['user-1'] }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, { assignee_ids: ['user-1'] }, { assignee_ids: ['user-1', KNECHT_ACCOUNT] }))
    const [run] = runsOf(trigger.id)
    expect(run!.inputs).toMatchObject({ assignee: 'Ann Example, Knecht' })
  })

  it('does not count Knecht taking the work item itself while it works on it', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'assigned' }], conditions: [] })
    const session = resolveSession(project, { integration: 'plane', kind: 'issue', key: `${project.identifier}-12` }, null)
    const run = makeRun(project, [], { sessionId: session.id, status: 'running' })
    await deliver(updated(project, { assignee_ids: [] }, { assignee_ids: [KNECHT_ACCOUNT] }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    db.update(schema.runs).set({ status: 'success' }).where(eq(schema.runs.id, run.id)).run()
    await deliver(updated(project, { assignee_ids: [] }, { assignee_ids: [KNECHT_ACCOUNT] }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('joins the assignees while it works and leaves the work item with them, else hands it back', async () => {
    const project = makePlaneProject()
    const object = { integration: 'plane', kind: 'issue', key: `${project.identifier}-12` }
    const id = `wi-${project.identifier}`
    const { take, handBack } = plane.capabilities.assignee!

    api.assignees.set(id, ['user-2'])
    expect(await take(project, object)).toEqual({ id: 'user-2', name: 'Bob' })
    expect(await take(project, object)).toBeNull()
    expect(await handBack(project, object, { id: 'user-3', name: 'Sam' })).toBe(`left ${object.key} with Bob`)
    expect(api.assigned).toEqual([['user-2', KNECHT_ACCOUNT], ['user-2']])

    api.assigned.length = 0
    api.assignees.set(id, [])
    expect(await take(project, object)).toBeNull()
    expect(await handBack(project, object, { id: 'user-3', name: 'Sam' })).toBe(`handed ${object.key} back to Sam`)
    expect(await take(project, object)).toEqual({ id: 'user-3', name: '' })
    api.assignees.set(id, [KNECHT_ACCOUNT])
    expect(await handBack(project, object, null)).toBe(`handed ${object.key} back to Ann Example`)
    expect(api.assigned).toEqual([[KNECHT_ACCOUNT], ['user-3'], ['user-3', KNECHT_ACCOUNT], ['user-1']])

    // Somebody took it from Knecht meanwhile: it stays theirs.
    api.assigned.length = 0
    api.assignees.set(id, ['user-2'])
    expect(await handBack(project, object, null)).toBe(`left ${object.key} with Bob`)
    expect(api.assigned).toEqual([])
  })

  it('closes the session of an archived or deleted work item', async () => {
    const project = makePlaneProject()
    const session = resolveSession(project, { integration: 'plane', kind: 'issue', key: `${project.identifier}-12` }, null)

    await deliver({ event: 'workitem.archived', entity_id: `wi-${project.identifier}`, data: item(project), previous_attributes: {} })
    expect(getSessionRow(session.id).status).toBe('closed')

    await deliver(updated(project, { state_id: 's-done' }, { state_id: 's-todo' }))
    expect(getSessionRow(session.id).status).toBe('open')

    await deliver({ event: 'workitem.deleted', entity_id: `wi-${project.identifier}`, data: {}, previous_attributes: item(project) })
    expect(getSessionRow(session.id).status).toBe('closed')
  })

  it('accepts the plain @knecht text as a mention', async () => {
    const project = makePlaneProject()
    const res = await deliver(commented(project, { id: '78', comment_html: '<p>@knecht have a look</p>', actor: 'user-2', created_at: '' }))
    expect(res.json).toMatchObject({ outcome: expect.stringContaining('setup hint') })
  })
})
