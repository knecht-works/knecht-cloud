import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { getSessionRow, makeProject } from '../helpers/db'
import { describeIntegrationWebhook, makeTrigger, runsOf, type WebhookRequest } from '../helpers/integration-webhook-suite'
import type { TriggerConfig } from '../../shared/utils/trigger-form'
import { allOf } from '../helpers/trigger-conditions'

const KNECHT_ACCOUNT = 'knecht-account-id'

const LABELS = { 'l-knecht': 'knecht', 'l-bug': 'bug' } as const
const STATES = [
  { id: 's-todo', name: 'Todo', type: 'unstarted' },
  { id: 's-progress', name: 'In Progress', type: 'started' },
  { id: 's-review', name: 'In Review', type: 'started' },
  { id: 's-done', name: 'Done', type: 'completed' },
]
const USERS: Record<string, string> = { 'user-1': 'Ann Example', [KNECHT_ACCOUNT]: 'Knecht' }

type Fetched = Record<string, unknown> & { id: string, identifier: string }
const api = vi.hoisted(() => ({
  issues: new Map<string, Record<string, unknown>>(),
  comment: {} as Record<string, unknown>,
  replies: [] as { issueId: string, body: string }[],
}))
vi.mock('../../server/integrations/linear/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/linear/api')>(),
  getLinearIssue: async (id: string) => {
    const issue = api.issues.get(id)
    if (!issue) throw new Error('not found')
    return issue
  },
  listLinearStates: async () => STATES,
  getLinearComment: async () => api.comment,
  addLinearComment: async (issueId: string, body: string) => {
    api.replies.push({ issueId, body })
    return {}
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { linear } = await import('../../server/integrations/linear')
const { linearConnection } = await import('../../server/integrations/linear/credentials')
const { resolveSession } = await import('../../server/utils/sessions')
const { setProjectLink } = await import('../../server/utils/project-links')
const handler = (await import('../../server/api/linear/webhook.post')).default

const SECRET = 'lin_wh_secret'

function request(payload: object, secret = SECRET): WebhookRequest {
  const body = JSON.stringify(payload)
  return { body, headers: { 'linear-signature': createHmac('sha256', secret).update(body).digest('hex') } }
}

function deliver(payload: object) {
  return callRoute(handler, request(payload))
}

let keyN = 0
function makeLinearProject() {
  const project = makeProject()
  const teamKey = `T${++keyN}`
  setProjectLink(project.id, 'linear', teamKey)
  return { ...project, teamKey }
}

function makeLinearTrigger(projectId: number, config: TriggerConfig) {
  return makeTrigger('linear', [projectId], config)
}

type LinearProject = { teamKey: string }

interface Overrides {
  stateId?: string
  labelIds?: (keyof typeof LABELS)[]
  assigneeId?: string | null
  priority?: number
}

const issueUrl = (project: LinearProject) => `https://linear.app/acme/issue/${project.teamKey}-12/login-broken`

// Stages what the API answers for the issue and returns the `data` of its delivery.
function item(project: LinearProject, { stateId = 's-todo', labelIds = ['l-knecht', 'l-bug'], assigneeId = null, priority = 0 }: Overrides = {}) {
  const fetched: Fetched = {
    id: `li-${project.teamKey}`,
    identifier: `${project.teamKey}-12`,
    title: 'Login broken',
    description: 'It fails on **submit**.',
    url: issueUrl(project),
    priority,
    state: STATES.find(s => s.id === stateId),
    creator: { name: USERS['user-1'] },
    assignee: assigneeId ? { id: assigneeId, name: USERS[assigneeId] } : null,
    labels: { nodes: labelIds.map(id => ({ id, name: LABELS[id] })) },
  }
  api.issues.set(fetched.id, fetched).set(fetched.identifier, fetched)
  return { id: fetched.id, identifier: fetched.identifier, title: fetched.title, url: fetched.url, stateId, labelIds, assigneeId, priority }
}

function created(project: LinearProject, overrides: Overrides = {}) {
  return { action: 'create', type: 'Issue', data: item(project, overrides) }
}

function updated(project: LinearProject, updatedFrom: Record<string, unknown>, overrides: Overrides = {}) {
  return { action: 'update', type: 'Issue', data: item(project, overrides), updatedFrom }
}

function commented(project: LinearProject, comment: { id: string, body: string, userId: string, mentions?: string[] }) {
  const data = item(project)
  api.comment = {
    id: comment.id,
    body: comment.body,
    bodyData: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: (comment.mentions ?? []).map(id => ({ type: 'suggestion_userMentions', attrs: { id } })) }] }),
    user: { id: comment.userId, name: USERS[comment.userId] ?? 'Bob' },
    issue: api.issues.get(data.id),
  }
  return { action: 'create', type: 'Comment', data: { id: comment.id, body: comment.body, issueId: data.id, userId: comment.userId } }
}

describeIntegrationWebhook<ReturnType<typeof makeLinearProject>, object>({
  integration: linear,
  handler,
  configure: () => linearConnection.save({ apiKey: 'k' }, { webhookSecret: SECRET, accountName: 'Knecht', accountId: KNECHT_ACCOUNT }),
  request,
  makeProject: makeLinearProject,
  unknownProject: () => created({ teamKey: 'NOPE' }),
  object: project => ({ integration: 'linear', kind: 'issue', key: `${project.teamKey}-12` }),
  created: {
    config: { kind: 'issue', on: [{ type: 'created' }], conditions: [] },
    delivery: project => created(project),
    run: project => ({
      trigger: 'linear',
      branch: 'main',
      inputs: {
        event: 'issue',
        identifier: `${project.teamKey}-12`,
        title: 'Login broken',
        body: 'It fails on **submit**.',
        url: issueUrl(project),
        status: 'Todo',
        assignee: '',
        labels: 'knecht, bug',
        author: 'Ann Example',
      },
    }),
    session: project => ({
      objectIntegration: 'linear',
      objectKind: 'issue',
      objectKey: `${project.teamKey}-12`,
      objectTitle: 'Login broken',
      objectUrl: issueUrl(project),
    }),
  },
  labeled: {
    config: { kind: 'issue', on: [{ type: 'labeled', values: ['knecht'] }], conditions: [] },
    notGained: project => [
      updated(project, { labelIds: ['l-knecht'] }, { labelIds: ['l-knecht', 'l-bug'] }),
      updated(project, { labelIds: [] }, { labelIds: ['l-bug'] }),
      updated(project, { title: 'old' }, { labelIds: ['l-knecht'] }),
    ],
    gained: project => updated(project, { labelIds: ['l-bug'] }, { labelIds: ['l-bug', 'l-knecht'] }),
  },
  closed: project => updated(project, { stateId: 's-todo' }, { stateId: 's-done' }),
  reopened: project => updated(project, { stateId: 's-done' }, { stateId: 's-todo' }),
  comment: {
    mention: project => commented(project, { id: 'c-77', body: '@bot please fix the login', userId: 'user-1', mentions: [KNECHT_ACCOUNT] }),
    fromSelf: project => commented(project, { id: 'c-79', body: '@knecht I am Knecht', userId: KNECHT_ACCOUNT }),
    withoutMention: project => commented(project, { id: 'c-80', body: 'just chatting', userId: 'user-1', mentions: ['user-1'] }),
    replyCount: project => api.replies.filter(r => r.issueId === `li-${project.teamKey}`).length,
  },
  recorded: {
    status: linearConnection.status,
    createdSummary: project => `Issue.create ${project.teamKey}-12`,
  },
})

describe('linear webhook route, vendor specifics', () => {
  it('fires on an issue created with the label, the status or the assignment already set', async () => {
    const project = makeLinearProject()
    const labeled = makeLinearTrigger(project.id, { kind: 'issue', on: [{ type: 'labeled', values: ['knecht'] }], conditions: [] })
    const transitioned = makeLinearTrigger(project.id, { kind: 'issue', on: [{ type: 'status', values: ['In Progress'] }], conditions: [] })
    const assigned = makeLinearTrigger(project.id, { kind: 'issue', on: [{ type: 'assigned' }], conditions: [] })

    await deliver(created(project, { labelIds: ['l-bug'] }))
    expect(runsOf(labeled.id)).toHaveLength(0)
    expect(runsOf(transitioned.id)).toHaveLength(0)
    expect(runsOf(assigned.id)).toHaveLength(0)

    await deliver(created(project, { stateId: 's-progress', assigneeId: KNECHT_ACCOUNT }))
    expect(runsOf(labeled.id)).toHaveLength(1)
    expect(runsOf(transitioned.id)).toHaveLength(1)
    expect(runsOf(assigned.id)).toHaveLength(1)
  })

  it('fires on a transition to the configured status', async () => {
    const project = makeLinearProject()
    const trigger = makeLinearTrigger(project.id, { kind: 'issue', on: [{ type: 'status', values: ['In Progress'] }], conditions: [] })
    await deliver(updated(project, { stateId: 's-todo' }, { stateId: 's-done' }))
    await deliver(updated(project, { title: 'old' }, { stateId: 's-progress' }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, { stateId: 's-todo' }, { stateId: 's-progress' }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires on a status category only when the issue enters it', async () => {
    const project = makeLinearProject()
    const trigger = makeLinearTrigger(project.id, { kind: 'issue', on: [{ type: 'status', values: ['type:started'] }], conditions: [] })
    await deliver(updated(project, { stateId: 's-progress' }, { stateId: 's-review' }))
    await deliver(updated(project, { stateId: 's-todo' }, { stateId: 's-done' }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, { stateId: 's-todo' }, { stateId: 's-review' }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('holds back issues its label and priority filters exclude', async () => {
    const project = makeLinearProject()
    const trigger = makeLinearTrigger(project.id, { kind: 'issue', on: [{ type: 'created' }], conditions: allOf({ label: ['knecht'], priority: ['urgent', 'high'] }) })
    await deliver(created(project, { labelIds: ['l-bug'], priority: 2 }))
    await deliver(created(project, { priority: 4 }))
    await deliver(created(project))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(created(project, { priority: 2 }))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires when the issue is assigned to the connection account', async () => {
    const project = makeLinearProject()
    const trigger = makeLinearTrigger(project.id, { kind: 'issue', on: [{ type: 'assigned' }], conditions: [] })
    await deliver(updated(project, { assigneeId: null }, { assigneeId: 'user-1' }))
    await deliver(updated(project, { title: 'old' }, { assigneeId: KNECHT_ACCOUNT }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, { assigneeId: null }, { assigneeId: KNECHT_ACCOUNT }))
    const [run] = runsOf(trigger.id)
    expect(run!.inputs).toMatchObject({ assignee: 'Knecht' })
  })

  it('closes the session of a removed, archived or trashed issue', async () => {
    const project = makeLinearProject()
    const session = resolveSession(project, { integration: 'linear', kind: 'issue', key: `${project.teamKey}-12` }, null)
    const reopen = () => deliver(updated(project, { stateId: 's-done' }, { stateId: 's-todo' }))

    await deliver({ action: 'remove', type: 'Issue', data: item(project) })
    expect(getSessionRow(session.id).status).toBe('closed')

    await reopen()
    expect(getSessionRow(session.id).status).toBe('open')
    await deliver({ action: 'update', type: 'Issue', data: { ...item(project), archivedAt: '2026-01-01T00:00:00Z' }, updatedFrom: { archivedAt: null } })
    expect(getSessionRow(session.id).status).toBe('closed')

    await reopen()
    await deliver({ action: 'update', type: 'Issue', data: { ...item(project), trashed: true }, updatedFrom: { trashed: null } })
    expect(getSessionRow(session.id).status).toBe('closed')
  })

  it('accepts the plain @knecht text as a mention', async () => {
    const project = makeLinearProject()
    const res = await deliver(commented(project, { id: 'c-78', body: '@knecht have a look', userId: 'user-2' }))
    expect(res.json).toMatchObject({ outcome: expect.stringContaining('setup hint') })
  })

  it('skips comments that are not on an issue and events Knecht does not use', async () => {
    const project = makeLinearProject()
    const payload = commented(project, { id: 'c-81', body: '@knecht hello', userId: 'user-1' })
    api.comment = { ...api.comment, issue: null }
    expect((await deliver(payload)).json).toEqual({ ok: true, skipped: 'no matching project' })
    expect((await deliver({ action: 'create', type: 'Project', data: { id: 'p-1' } })).json).toEqual({ ok: true, skipped: 'no matching project' })
  })
})
