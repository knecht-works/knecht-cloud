import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { makeProject, makeRun } from '../helpers/db'

const comments: { issue: number, body: string }[] = []
const labels: { added: string[], removed: string[] } = { added: [], removed: [] }
vi.mock('../../server/utils/github-app', () => ({
  getInstallationToken: async () => 'test-token',
  createIssueComment: async (_o: string, _r: string, issue: number, body: string) => {
    comments.push({ issue, body })
    return { url: 'https://x/comment/1' }
  },
  listRepoLabels: async () => ['bug', 'help wanted'],
  addIssueLabels: async (_o: string, _r: string, _n: number, names: string[]) => {
    labels.added.push(...names)
  },
  removeIssueLabel: async (_o: string, _r: string, _n: number, name: string) => {
    labels.removed.push(name)
  },
  createPullRequest: async () => null,
}))
const jiraApi = vi.hoisted(() => ({
  comments: [] as { key: string, body: unknown }[],
  labels: [] as { key: string, add: string[], remove: string[] }[],
  transitions: [] as { key: string, id: string }[],
}))
vi.mock('../../server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/jira/api')>(),
  addJiraComment: async (key: string, body: unknown) => {
    jiraApi.comments.push({ key, body })
    return { url: `https://acme.atlassian.net/browse/${key}?focusedCommentId=1` }
  },
  updateJiraLabels: async (key: string, add: string[], remove: string[]) => {
    jiraApi.labels.push({ key, add, remove })
  },
  listJiraTransitions: async () => [{ id: '11', to: 'In Progress' }, { id: '21', to: 'In Review' }],
  transitionJiraIssue: async (key: string, id: string) => {
    jiraApi.transitions.push({ key, id })
  },
}))

const { db, schema } = await import('../../server/db')
const { bridgeToken } = await import('../../server/utils/agent-bridge')
const { sessionCheckoutDir } = await import('../../server/utils/storage')
const handler = (await import('../../server/routes/agent-bridge.post')).default

function call(sessionId: number, body: object, token = bridgeToken(sessionId)) {
  return callRoute(handler, { body, headers: { 'x-knecht-run-id': String(sessionId), 'x-knecht-token': token } })
}

function bindObject(sessionId: number, kind: 'issue' | 'pull_request' = 'issue', number = 5) {
  db.update(schema.sessions).set({ objectIntegration: 'github', objectKind: kind, objectKey: String(number) }).where(eq(schema.sessions.id, sessionId)).run()
}

function objectSession(overrides: Parameters<typeof makeRun>[2] = {}) {
  const project = makeProject()
  const run = makeRun(project, [], { status: 'success', ...overrides })
  mkdirSync(join(sessionCheckoutDir(run.sessionId), '.git'), { recursive: true })
  bindObject(run.sessionId)
  return { project, run, sessionId: run.sessionId }
}

function ticketSession() {
  const project = makeProject()
  const run = makeRun(project, [], { status: 'success' })
  mkdirSync(join(sessionCheckoutDir(run.sessionId), '.git'), { recursive: true })
  db.update(schema.sessions).set({ objectIntegration: 'jira', objectKind: 'issue', objectKey: 'PROJ-1' }).where(eq(schema.sessions.id, run.sessionId)).run()
  return { project, run, sessionId: run.sessionId }
}

describe('agent bridge', () => {
  it('rejects a bad token and an unknown session', async () => {
    const { sessionId } = objectSession()
    expect((await call(sessionId, { op: 'comment', body: 'hi' }, 'nope')).status).toBe(401)
    expect((await call(999_999, { op: 'comment', body: 'hi' })).status).toBe(404)
  })

  it('refuses a session without a checkout', async () => {
    const run = makeRun(makeProject(), [])
    const res = await call(run.sessionId, { op: 'comment', body: 'hi' })
    expect(res.status).toBe(409)
    expect(res.text).toContain('no checkout')
  })

  it('rejects an unknown op', async () => {
    const { sessionId } = objectSession()
    const res = await call(sessionId, { op: 'assign', to: 'me' })
    expect(res.status).toBe(400)
    expect(res.text).toContain('invalid request')
  })

  it('refuses a status change where the integration has no statuses', async () => {
    const { sessionId } = objectSession()
    const res = await call(sessionId, { op: 'status', status: 'Done' })
    expect(res.status).toBe(400)
    expect(res.text).toContain('not supported for issue #5')
  })

  it('refuses to comment on a session that has no object', async () => {
    const run = makeRun(makeProject(), [])
    mkdirSync(join(sessionCheckoutDir(run.sessionId), '.git'), { recursive: true })
    const res = await call(run.sessionId, { op: 'comment', body: 'hi' })
    expect(res.status).toBe(400)
    expect(res.text).toContain('does not belong to a ticket, issue or pull request')
  })

  it('posts a comment on the object and records the reply', async () => {
    const { sessionId, run } = objectSession()
    const res = await call(sessionId, { op: 'comment', body: 'All done.' })
    expect(res.status).toBe(200)
    expect(res.text).toBe('posted the reply on issue #5: https://x/comment/1\n')
    expect(comments.at(-1)).toEqual({ issue: 5, body: 'All done.' })
    const log = db.select({ log: schema.runs.log }).from(schema.runs).where(eq(schema.runs.id, run.id)).get()!.log
    expect(log).toContain('agent-reply: commented on issue #5')
  })

  it('refuses replies while a workflow with replies disabled is running', async () => {
    const wf = db.insert(schema.workflows).values({ name: 'silent', steps: [], repliesEnabled: false }).returning().get()
    const { sessionId } = objectSession({ status: 'running', workflowId: wf.id })
    const res = await call(sessionId, { op: 'comment', body: 'hi' })
    expect(res.status).toBe(400)
    expect(res.text).toContain('disabled for this workflow')
  })

  it('applies only existing labels and removes labels', async () => {
    const { sessionId } = objectSession()
    const unknown = await call(sessionId, { op: 'label', add: ['nope'] })
    expect(unknown.status).toBe(400)
    expect(unknown.text).toContain('do not exist in the repo')

    const empty = await call(sessionId, { op: 'label' })
    expect(empty.status).toBe(400)

    const res = await call(sessionId, { op: 'label', add: ['bug'], remove: ['help wanted'] })
    expect(res.status).toBe(200)
    expect(res.text).toBe('added bug; removed help wanted on issue #5\n')
    expect(labels).toEqual({ added: ['bug'], removed: ['help wanted'] })
  })
})

describe('agent bridge on a Jira ticket', () => {
  it('posts the comment as ADF', async () => {
    const { sessionId } = ticketSession()
    const res = await call(sessionId, { op: 'comment', body: 'Done, see `auth.php`.' })
    expect(res.status).toBe(200)
    expect(res.text).toBe('posted the reply on ticket PROJ-1: https://acme.atlassian.net/browse/PROJ-1?focusedCommentId=1\n')
    expect(jiraApi.comments.at(-1)).toMatchObject({ key: 'PROJ-1', body: { type: 'doc' } })
  })

  it('adds and removes labels without a registry check', async () => {
    const { sessionId } = ticketSession()
    const res = await call(sessionId, { op: 'label', add: ['anything'], remove: ['old'] })
    expect(res.status).toBe(200)
    expect(res.text).toBe('added anything; removed old on ticket PROJ-1\n')
    expect(jiraApi.labels.at(-1)).toEqual({ key: 'PROJ-1', add: ['anything'], remove: ['old'] })
  })

  it('moves the ticket through the transition whose target matches the status', async () => {
    const { sessionId, run } = ticketSession()
    const res = await call(sessionId, { op: 'status', status: 'in review' })
    expect(res.status).toBe(200)
    expect(res.text).toBe('moved to "In Review" on ticket PROJ-1\n')
    expect(jiraApi.transitions.at(-1)).toEqual({ key: 'PROJ-1', id: '21' })
    const log = db.select({ log: schema.runs.log }).from(schema.runs).where(eq(schema.runs.id, run.id)).get()!.log
    expect(log).toContain('agent-status: moved to "In Review" on ticket PROJ-1')

    const unknown = await call(sessionId, { op: 'status', status: 'Shipped' })
    expect(unknown.status).toBe(400)
    expect(unknown.text).toContain('Reachable: In Progress, In Review')
  })
})
