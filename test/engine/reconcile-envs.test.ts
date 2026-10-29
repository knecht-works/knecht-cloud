import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getSessionRow, makeProject, makeRun } from '../helpers/db'

const startEnvStack = vi.fn(async (_sessionId: number) => {})
const stopEnvStack = vi.fn(async (_sessionId: number) => {})
const forgetPreview = vi.fn()
vi.mock('../../server/daemon/sandbox', () => ({
  envStackRunning: async () => true,
  execInSandbox: async () => ({ stdout: '' }),
  forgetPreview: (sessionId: number) => forgetPreview(sessionId),
  removeEnvStack: async () => {},
  startEnvStack: (sessionId: number) => startEnvStack(sessionId),
  stopEnvStack: (sessionId: number) => stopEnvStack(sessionId),
}))
vi.mock('../../server/daemon/workspace', () => ({ ensureWorkspaceUp: async () => {}, removeWorkspace: async () => {} }))

const { db, schema } = await import('../../server/db')
const { reconcileEnvStates } = await import('../../server/daemon/envs')

function makeSessionInState(envState: 'up' | 'stopped' | 'archived', tier: 'code' | 'preview' = 'preview') {
  const project = makeProject()
  const run = makeRun(project, [])
  db.update(schema.sessions)
    .set({ envState, tier, previewLastSeen: new Date() })
    .where(eq(schema.sessions.id, run.sessionId))
    .run()
  return run
}

describe('reconcileEnvStates', () => {
  it('starts every up env and keeps it up', async () => {
    const a = makeSessionInState('up')
    const b = makeSessionInState('up')
    await reconcileEnvStates()
    expect(startEnvStack).toHaveBeenCalledWith(a.sessionId)
    expect(startEnvStack).toHaveBeenCalledWith(b.sessionId)
    expect(getSessionRow(a.sessionId).envState).toBe('up')
    expect(getSessionRow(b.sessionId).envState).toBe('up')
  })

  it('downgrades an env whose start fails to stopped and forgets its preview IP', async () => {
    const broken = makeSessionInState('up')
    const fine = makeSessionInState('up')
    // The broken session is pinned to the front so the one-shot failing start hits it.
    db.update(schema.sessions)
      .set({ previewLastSeen: new Date(Date.now() + 60_000) })
      .where(eq(schema.sessions.id, broken.sessionId))
      .run()
    startEnvStack.mockImplementationOnce(async () => {
      throw new Error('volume gone')
    })
    await reconcileEnvStates()
    expect(getSessionRow(broken.sessionId).envState).toBe('stopped')
    expect(getSessionRow(fine.sessionId).envState).toBe('up')
    expect(forgetPreview).toHaveBeenCalledWith(broken.sessionId)
  })

  it('stops a ddev stack an up code session should not have, and starts nothing', async () => {
    const code = makeSessionInState('up', 'code')
    startEnvStack.mockClear()
    await reconcileEnvStates()
    expect(stopEnvStack).toHaveBeenCalledWith(code.sessionId)
    expect(startEnvStack).not.toHaveBeenCalledWith(code.sessionId)
    expect(getSessionRow(code.sessionId).envState).toBe('up')
  })

  it('leaves stopped and archived envs on the retention ladder', async () => {
    const stopped = makeSessionInState('stopped')
    const archived = makeSessionInState('archived')
    startEnvStack.mockClear()
    await reconcileEnvStates()
    expect(startEnvStack).not.toHaveBeenCalledWith(stopped.sessionId)
    expect(startEnvStack).not.toHaveBeenCalledWith(archived.sessionId)
    expect(getSessionRow(stopped.sessionId).envState).toBe('stopped')
    expect(getSessionRow(archived.sessionId).envState).toBe('archived')
  })
})
