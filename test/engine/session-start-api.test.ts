import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { makeProject, makeSession } from '../helpers/db'

const dispatched: number[] = []
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => dispatched.push(1) }))

const { db, schema } = await import('../../server/db')
const startHandler = (await import('../../server/api/projects/[id]/sessions.post')).default
const previewHandler = (await import('../../server/api/sessions/[id]/preview.post')).default

function start(projectId: number, body: Record<string, unknown> = {}) {
  return callRoute(startHandler, { route: '/projects/:id/sessions', path: `/projects/${projectId}/sessions`, body })
}

function addPreview(sessionId: number) {
  return callRoute(previewHandler, { route: '/sessions/:id/preview', path: `/sessions/${sessionId}/preview`, body: {} })
}

function runOf(res: { json: unknown }) {
  const { id } = res.json as { id: number }
  return db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()!
}

describe('POST /api/projects/:id/sessions', () => {
  it('starts a session without a workflow that boots a preview', async () => {
    const project = makeProject()
    const before = dispatched.length
    const res = await start(project.id, { preview: true })
    expect(res.status).toBe(200)
    const run = runOf(res)
    expect(run).toMatchObject({ workflow: 'Boot preview', workflowId: null, trigger: 'manual', status: 'queued', branch: 'main' })
    expect(run.steps).toEqual([{ type: 'ddev-start', id: 'boot-preview' }])
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, run.sessionId)).get()!
    expect(session).toMatchObject({ projectId: project.id, objectKind: null, branch: 'main' })
    expect(dispatched.length).toBe(before + 1)
  })

  it('starts a code-only session on the requested branch', async () => {
    const project = makeProject()
    const run = runOf(await start(project.id, { branch: 'feature/x' }))
    expect(run).toMatchObject({ workflow: 'Checkout', branch: 'feature/x' })
    expect(run.steps).toEqual([])
  })

  it('starts a new session on every call', async () => {
    const project = makeProject()
    const a = runOf(await start(project.id))
    const b = runOf(await start(project.id))
    expect(a.sessionId).not.toBe(b.sessionId)
  })

  it('refuses an unknown project', async () => {
    expect((await start(999_999)).status).toBe(404)
  })
})

describe('POST /api/sessions/:id/preview', () => {
  it('queues a boot run in an existing code session', async () => {
    const project = makeProject()
    const session = makeSession(project, { envState: 'up', tier: 'code', branch: 'fix/y' })
    const res = await addPreview(session.id)
    expect(res.status).toBe(200)
    const run = runOf(res)
    expect(run).toMatchObject({ sessionId: session.id, workflow: 'Boot preview', workflowId: null, branch: 'fix/y' })
    expect(run.steps).toEqual([{ type: 'ddev-start', id: 'boot-preview' }])
  })

  it('refuses a session that already has a preview', async () => {
    const session = makeSession(makeProject(), { envState: 'up', tier: 'preview' })
    expect((await addPreview(session.id)).status).toBe(409)
  })

  it('refuses an unknown session', async () => {
    expect((await addPreview(999_999)).status).toBe(404)
  })
})
