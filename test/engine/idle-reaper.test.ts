import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeProject, makeRun } from '../helpers/db'

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
  db.update(schema.runs)
    .set({ envState: 'up', previewLastSeen })
    .where(eq(schema.runs.id, run.id))
    .run()
  return run
}

function getRunRow(runId: number) {
  return db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()!
}

const STALE = new Date(Date.now() - 3 * 24 * 60 * 60_000)

describe('reapIdleEnvs', () => {
  it('stops a stale env and leaves a fresh one alone', async () => {
    const stale = makeUpRun(STALE)
    const fresh = makeUpRun(new Date())
    await reapIdleEnvs()
    expect(stopEnvStack).toHaveBeenCalledWith(stale.id)
    expect(getRunRow(stale.id).envState).toBe('stopped')
    expect(getRunRow(fresh.id).envState).toBe('up')
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
    expect(stopEnvStack).not.toHaveBeenCalledWith(busy.id)
    const row = getRunRow(busy.id)
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
    expect(getRunRow(run.id).envState).toBe('up')
    // Step finishes; the bumped clock keeps the env up through the next tick.
    db.update(schema.runSteps).set({ status: 'success' }).where(eq(schema.runSteps.id, step.id)).run()
    await reapIdleEnvs()
    expect(getRunRow(run.id).envState).toBe('up')
    // Only once the full idle window has passed after the bump does it stop.
    db.update(schema.runs).set({ previewLastSeen: STALE }).where(eq(schema.runs.id, run.id)).run()
    await reapIdleEnvs()
    expect(getRunRow(run.id).envState).toBe('stopped')
  })
})
