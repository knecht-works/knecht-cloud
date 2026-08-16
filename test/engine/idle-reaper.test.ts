import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getSessionRow, makeProject, makeRun } from '../helpers/db'

// The idle reaper against the real schema: only the container boundary is
// faked. The contract under test: a stale env is stopped, but a run with a
// step still executing is spared and gets a fresh idle window instead of a
// SIGKILL under the working agent.

const stopEnvStack = vi.fn(async () => {})
vi.mock('../../server/daemon/sandbox', () => ({
  envStackRunning: async () => true,
  execInSandbox: async () => ({ stdout: '' }),
  removeEnvStack: async () => {},
  startEnvStack: async () => {},
  stopEnvStack: (runId: number) => stopEnvStack(runId),
}))

const { db, schema } = await import('../../server/db')
const { reapIdleEnvs } = await import('../../server/daemon/envs')

function makeUpRun(previewLastSeen: Date) {
  const project = makeProject()
  const run = makeRun(project, [])
  db.update(schema.sessions)
    .set({ envState: 'up', previewLastSeen })
    .where(eq(schema.sessions.id, run.sessionId))
    .run()
  return run
}

const STALE = new Date(Date.now() - 3 * 24 * 60 * 60_000)

describe('reapIdleEnvs', () => {
  it('stops a stale env and leaves a fresh one alone', async () => {
    const stale = makeUpRun(STALE)
    const fresh = makeUpRun(new Date())
    await reapIdleEnvs()
    expect(stopEnvStack).toHaveBeenCalledWith(stale.sessionId)
    expect(getSessionRow(stale.sessionId).envState).toBe('stopped')
    expect(getSessionRow(fresh.sessionId).envState).toBe('up')
  })

  it('spares a stale env with a running step and resets its idle clock', async () => {
    const busy = makeUpRun(STALE)
    db.insert(schema.runSteps).values({
      runId: busy.id,
      stepIndex: 0,
      stepId: 'followup-1',
      type: 'ai',
      origin: 'followup',
    }).run()
    stopEnvStack.mockClear()
    await reapIdleEnvs()
    expect(stopEnvStack).not.toHaveBeenCalledWith(busy.sessionId)
    const row = getSessionRow(busy.sessionId)
    expect(row.envState).toBe('up')
    expect(row.previewLastSeen!.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('stops the env once the step has finished and the window passed again', async () => {
    const run = makeUpRun(STALE)
    const step = db.insert(schema.runSteps).values({
      runId: run.id,
      stepIndex: 0,
      stepId: 'followup-1',
      type: 'ai',
      origin: 'followup',
    }).returning({ id: schema.runSteps.id }).get()
    await reapIdleEnvs()
    expect(getSessionRow(run.sessionId).envState).toBe('up')
    // Step finishes; the bumped clock keeps the env up through the next tick.
    db.update(schema.runSteps).set({ status: 'success' }).where(eq(schema.runSteps.id, step.id)).run()
    await reapIdleEnvs()
    expect(getSessionRow(run.sessionId).envState).toBe('up')
    // Only once the full idle window has passed after the bump does it stop.
    db.update(schema.sessions).set({ previewLastSeen: STALE }).where(eq(schema.sessions.id, run.sessionId)).run()
    await reapIdleEnvs()
    expect(getSessionRow(run.sessionId).envState).toBe('stopped')
  })
})
