import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { getSessionRow, makeProject } from '../helpers/db'

const KNECHT_ACCOUNT = 'knecht-account-id'

const workItem = vi.hoisted(() => (id: string) => ({
  id,
  sequence_id: 12,
  name: 'Login broken',
  description_html: '<p>It fails on <strong>submit</strong>.</p>',
  state: 's-todo',
  labels: ['l-knecht', 'l-bug'],
  assignees: [],
  created_by: 'user-1',
}))
const api = vi.hoisted(() => ({
  projects: [] as { id: string, identifier: string, name: string }[],
  comments: [] as { projectId: string, workItemId: string, html: string }[],
  fetched: {
    id: '77',
    comment_html: '',
    actor: { id: 'user-1', first_name: 'Ann', last_name: 'Example' },
    created_at: '2026-01-01T00:00:00Z',
  },
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
  listPlaneMembers: async () => [{ id: 'user-1', displayName: 'Ann Example' }, { id: KNECHT_ACCOUNT, displayName: 'Knecht' }],
  getPlaneComment: async () => api.fetched,
  addPlaneComment: async (projectId: string, workItemId: string, html: string) => {
    api.comments.push({ projectId, workItemId, html })
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { db, schema } = await import('../../server/db')
const { planeConnectionStatus, savePlaneCredentials } = await import('../../server/integrations/plane/credentials')
const { resolveSession } = await import('../../server/utils/sessions')
const { setProjectLink } = await import('../../server/utils/project-links')
const handler = (await import('../../server/api/plane/webhook.post')).default

const SECRET = 'plane_wh_secret'

function deliver(payload: { event: string }, secret = SECRET) {
  const raw = JSON.stringify(payload)
  return callRoute(handler, {
    body: raw,
    headers: {
      'x-plane-event': payload.event,
      'x-plane-signature': createHmac('sha256', secret).update(raw).digest('hex'),
    },
  })
}

let n = 0
function makeWorkflow() {
  return db.insert(schema.workflows).values({
    name: `plane-route-${++n}`,
    steps: [{ type: 'bash', command: 'true', id: 'run' }],
    publishedAt: new Date(),
  }).returning().get()
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

function makePlaneTrigger(projectId: number, config: Record<string, unknown>) {
  return db.insert(schema.triggers).values({
    source: 'plane',
    workflowId: makeWorkflow().id,
    projectIds: [projectId],
    config,
  }).returning().get()
}

function runsOf(triggerId: number) {
  return db.select().from(schema.runs).where(eq(schema.runs.triggerId, triggerId)).all()
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

function commented(project: PlaneProject, commentId: string) {
  return {
    event: 'workitem.comment.created',
    entity_id: `wi-${project.identifier}`,
    data: { id: `wi-${project.identifier}`, name: 'Login broken', comment: { id: commentId, actor_id: 'user-1', issue_id: `wi-${project.identifier}` } },
    previous_attributes: {},
  }
}

describe('plane webhook route, unconfigured', () => {
  it('answers 404 until Plane is connected', async () => {
    const res = await deliver({ event: 'workitem.created' }, 'anything')
    expect(res.status).toBe(404)
  })
})

describe('plane webhook route', () => {
  beforeAll(() => {
    savePlaneCredentials({ siteUrl: 'https://app.plane.so', workspaceSlug: 'acme', apiKey: 'k', webhookSecret: SECRET, accountName: 'Knecht', accountId: KNECHT_ACCOUNT })
  })

  it('rejects a bad signature', async () => {
    const res = await deliver({ event: 'workitem.created' }, 'wrong')
    expect(res.status).toBe(401)
  })

  it('skips work items of Plane projects no project is linked to', async () => {
    api.projects.push({ id: 'pp-NOPE', identifier: 'NOPE', name: 'Unlinked' })
    const res = await deliver(created({ identifier: 'NOPE', planeId: 'pp-NOPE' }))
    expect(res.json).toEqual({ ok: true, skipped: 'no matching project' })
  })

  it('fires on a created work item with the work item as inputs and object', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'created' }], filters: {} })
    const res = await deliver(created(project))
    expect(res.json).toEqual({ ok: true, runIds: [expect.any(Number)] })
    const [run] = runsOf(trigger.id)
    expect(run).toMatchObject({
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
    })
    expect(getSessionRow(run!.sessionId)).toMatchObject({
      objectIntegration: 'plane',
      objectKind: 'issue',
      objectKey: `${project.identifier}-12`,
      objectTitle: 'Login broken',
      objectUrl: `https://app.plane.so/acme/browse/${project.identifier}-12/`,
    })
  })

  it('fires on a label only when the work item gains it', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'labeled', value: 'knecht' }], filters: {} })

    await deliver(updated(project, { label_ids: ['l-knecht'] }, { label_ids: ['l-knecht', 'l-bug'] }))
    await deliver(updated(project, { label_ids: [] }, { label_ids: ['l-bug'] }))
    await deliver(updated(project, { name: 'old' }, { label_ids: ['l-knecht'] }))
    expect(runsOf(trigger.id)).toHaveLength(0)

    await deliver(updated(project, { label_ids: ['l-bug'] }, { label_ids: ['l-bug', 'l-knecht'] }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires on a work item created with the label, the state or the assignment already set', async () => {
    const project = makePlaneProject()
    const labeled = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'labeled', value: 'knecht' }], filters: {} })
    const transitioned = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'state', value: 'In Progress' }], filters: {} })
    const assigned = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'assigned' }], filters: {} })

    await deliver(created(project, { label_ids: ['l-bug'] }))
    expect(runsOf(labeled.id)).toHaveLength(0)
    expect(runsOf(transitioned.id)).toHaveLength(0)
    expect(runsOf(assigned.id)).toHaveLength(0)

    await deliver(created(project, { state_id: 's-progress', assignee_ids: [KNECHT_ACCOUNT] }))
    expect(runsOf(labeled.id)).toHaveLength(1)
    expect(runsOf(transitioned.id)).toHaveLength(1)
    expect(runsOf(assigned.id)).toHaveLength(1)
  })

  it('fires on a transition to the configured state', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'state', value: 'In Progress' }], filters: {} })
    await deliver(updated(project, { state_id: 's-todo' }, { state_id: 's-done' }))
    await deliver(updated(project, { name: 'old' }, { state_id: 's-progress' }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, { state_id: 's-todo' }, { state_id: 's-progress' }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires on a state group only when the work item enters it', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'state', value: 'group:started' }], filters: {} })
    await deliver(updated(project, { state_id: 's-progress' }, { state_id: 's-review' }))
    await deliver(updated(project, { state_id: 's-todo' }, { state_id: 's-done' }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, { state_id: 's-todo' }, { state_id: 's-review' }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires once when any of several events matches', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'labeled', value: 'knecht' }, { type: 'assigned' }], filters: {} })
    await deliver(updated(project, { label_ids: [], assignee_ids: [] }, { label_ids: ['l-knecht'], assignee_ids: [KNECHT_ACCOUNT] }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('holds back work items its label and priority filters exclude', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'created' }], filters: { label: ['kn*'], priority: ['urgent', 'high'] } })
    await deliver(created(project, { label_ids: ['l-bug'], priority: 'high' }))
    await deliver(created(project, { priority: 'low' }))
    await deliver(created(project))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(created(project, { priority: 'High' }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires when the work item is assigned to the connection account', async () => {
    const project = makePlaneProject()
    const trigger = makePlaneTrigger(project.id, { kind: 'issue', on: [{ type: 'assigned' }], filters: {} })
    await deliver(updated(project, { assignee_ids: [] }, { assignee_ids: ['user-1'] }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, { assignee_ids: ['user-1'] }, { assignee_ids: ['user-1', KNECHT_ACCOUNT] }))
    const [run] = runsOf(trigger.id)
    expect(run!.inputs).toMatchObject({ assignee: 'Ann Example, Knecht' })
  })

  it('mirrors completed, reopened, archived and deleted onto the session', async () => {
    const project = makePlaneProject()
    const key = `${project.identifier}-12`
    const session = resolveSession(project, { integration: 'plane', kind: 'issue', key }, null)

    await deliver(updated(project, { state_id: 's-todo' }, { state_id: 's-done' }))
    expect(getSessionRow(session.id).status).toBe('closed')

    await deliver(updated(project, { state_id: 's-done' }, { state_id: 's-todo' }))
    expect(getSessionRow(session.id).status).toBe('open')

    await deliver({ event: 'workitem.archived', entity_id: `wi-${project.identifier}`, data: item(project), previous_attributes: {} })
    expect(getSessionRow(session.id).status).toBe('closed')

    await deliver(updated(project, { state_id: 's-done' }, { state_id: 's-todo' }))
    expect(getSessionRow(session.id).status).toBe('open')

    await deliver({ event: 'workitem.deleted', entity_id: `wi-${project.identifier}`, data: {}, previous_attributes: item(project) })
    expect(getSessionRow(session.id).status).toBe('closed')
  })

  it('turns a comment mentioning the connection account into a follow-up, finding the project by the work item', async () => {
    const project = makePlaneProject()
    api.fetched = {
      id: '77',
      comment_html: `<p><mention-component entity_identifier="${KNECHT_ACCOUNT}" entity_name="user_mention" label="Knecht"></mention-component> please fix the login</p>`,
      actor: { id: 'user-1', first_name: 'Ann', last_name: 'Example' },
      created_at: '2026-01-01T00:00:00Z',
    }
    const res = await deliver(commented(project, '77'))
    expect(res.json).toMatchObject({ outcome: expect.stringContaining('setup hint') })
    expect(api.comments.at(-1)).toMatchObject({ projectId: project.planeId, workItemId: `wi-${project.identifier}` })
    const session = resolveSession(project, { integration: 'plane', kind: 'issue', key: `${project.identifier}-12` }, null)
    expect(getSessionRow(session.id).objectIntegration).toBe('plane')
  })

  it('accepts the plain @knecht text as a mention', async () => {
    const project = makePlaneProject()
    api.fetched = { id: '78', comment_html: '<p>@knecht have a look</p>', actor: { id: 'user-2', display_name: 'Bob' }, created_at: '' }
    const res = await deliver(commented(project, '78'))
    expect(res.json).toMatchObject({ outcome: expect.stringContaining('setup hint') })
  })

  it('remembers the last accepted and the last rejected delivery for the settings page', async () => {
    const project = makePlaneProject()
    await deliver(created(project))
    expect(planeConnectionStatus().lastDelivery).toMatchObject({ summary: `workitem.created ${project.identifier}-12`, at: expect.any(Number) })

    await deliver(created(project), 'wrong')
    expect(planeConnectionStatus().lastRejected).toMatchObject({ reason: 'signature', at: expect.any(Number) })

    await callRoute(handler, { body: '', headers: { 'x-plane-signature': '00' } })
    expect(planeConnectionStatus().lastRejected?.reason).toBe('empty-body')

    await deliver(created({ identifier: 'NOPE', planeId: 'pp-NOPE' }))
    expect(planeConnectionStatus().lastRejected?.reason).toBe('no-project')
    expect(planeConnectionStatus().lastDelivery?.summary).toBe(`workitem.created ${project.identifier}-12`)
  })

  it('ignores comments by the connection account and comments without a mention', async () => {
    const project = makePlaneProject()
    api.fetched = { id: '79', comment_html: '<p>@knecht I am Knecht</p>', actor: { id: KNECHT_ACCOUNT, display_name: 'Knecht' }, created_at: '' }
    expect((await deliver(commented(project, '79'))).json)
      .toMatchObject({ outcome: expect.stringContaining('Knecht itself') })
    api.fetched = { id: '80', comment_html: '<p>just chatting</p>', actor: { id: 'user-1', first_name: 'Ann', last_name: 'Example' }, created_at: '' }
    expect((await deliver(commented(project, '80'))).json)
      .toMatchObject({ outcome: expect.stringContaining('no mention') })
  })
})
