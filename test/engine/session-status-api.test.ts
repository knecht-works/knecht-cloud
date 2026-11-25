import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { getSessionRow, makeProject, makeRun } from '../helpers/db'

const stopEnvStack = vi.fn(async (_sessionId: number) => {})
vi.mock('#server/daemon/sandbox', () => ({
  envStackRunning: async () => true,
  execInSandbox: async () => ({ stdout: '' }),
  removeEnvStack: async () => {},
  startEnvStack: async () => {},
  stopEnvStack: (sessionId: number) => stopEnvStack(sessionId),
}))

const { db, schema } = await import('#server/db')
const handler = (await import('#server/api/sessions/[id]/status.post')).default

function post(sessionId: number, status: 'open' | 'closed') {
  return callRoute(handler, { method: 'POST', route: '/sessions/:id/status', path: `/sessions/${sessionId}/status`, body: { status } })
}

function upSession(runStatus: 'success' | 'running' = 'success') {
  const run = makeRun(makeProject(), [], { status: runStatus })
  db.update(schema.sessions).set({ envState: 'up', tier: 'preview' }).where(eq(schema.sessions.id, run.sessionId)).run()
  return run.sessionId
}

describe('POST /api/sessions/:id/status', () => {
  it('stops the environment of a session marked done', async () => {
    const sessionId = upSession()
    expect((await post(sessionId, 'closed')).status).toBe(200)
    await vi.waitFor(() => expect(getSessionRow(sessionId).envState).toBe('stopped'))
    expect(stopEnvStack).toHaveBeenCalledWith(sessionId)
  })

  it('keeps the environment while a run is still working', async () => {
    const sessionId = upSession('running')
    stopEnvStack.mockClear()
    expect((await post(sessionId, 'closed')).status).toBe(200)
    expect(stopEnvStack).not.toHaveBeenCalled()
    expect(getSessionRow(sessionId).envState).toBe('up')
  })

  it('leaves the environment alone when a session is reopened', async () => {
    const sessionId = upSession()
    db.update(schema.sessions).set({ status: 'closed' }).where(eq(schema.sessions.id, sessionId)).run()
    stopEnvStack.mockClear()
    expect((await post(sessionId, 'open')).status).toBe(200)
    expect(stopEnvStack).not.toHaveBeenCalled()
  })
})
