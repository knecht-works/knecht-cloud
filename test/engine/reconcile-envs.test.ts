import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getSessionRow, makeProject, makeRun } from '../helpers/db'

// Boot-time restore against the real schema: only the container boundary is
// faked. The contract under test: after a reboot every 'up' env is brought
// back with an unconditional `ddev start` (the only operation that knows a
// project's full service set); a failing start downgrades to 'stopped'; and
// stopped/archived envs stay exactly where the retention ladder put them.

const startEnvStack = vi.fn(async (_sessionId: number) => {})
const forgetPreview = vi.fn()
vi.mock('../../server/daemon/sandbox', () => ({
  envStackRunning: async () => true,
  execInSandbox: async () => ({ stdout: '' }),
  forgetPreview: (sessionId: number) => forgetPreview(sessionId),
  removeEnvStack: async () => {},
  startEnvStack: (sessionId: number) => startEnvStack(sessionId),
  stopEnvStack: async () => {},
}))

const { db, schema } = await import('../../server/db')
const { reconcileEnvStates } = await import('../../server/daemon/envs')

function makeSessionInState(envState: 'up' | 'stopped' | 'archived') {
  const project = makeProject()
  const run = makeRun(project, [])
  db.update(schema.sessions)
    .set({ envState, previewLastSeen: new Date() })
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
    // Most recently seen runs first: pin the broken session to the front so
    // the one-shot failing start deterministically hits it.
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
