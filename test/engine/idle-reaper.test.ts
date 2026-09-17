import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getSessionRow, makeProject, makeRun } from '../helpers/db'

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
      stepId: 'build',
      type: 'bash',
    }).run()
    stopEnvStack.mockClear()
    await reapIdleEnvs()
    expect(stopEnvStack).not.toHaveBeenCalledWith(busy.sessionId)
    const row = getSessionRow(busy.sessionId)
    expect(row.envState).toBe('up')
    expect(row.previewLastSeen!.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('stops the env once the follow-up has finished and the window passed again', async () => {
    const run = makeUpRun(STALE)
    const followup = db.insert(schema.followups).values({
      sessionId: run.sessionId,
      runId: run.id,
      prompt: 'more',
      status: 'running',
    }).returning({ id: schema.followups.id }).get()
    await reapIdleEnvs()
    expect(getSessionRow(run.sessionId).envState).toBe('up')
    db.update(schema.followups).set({ status: 'success' }).where(eq(schema.followups.id, followup.id)).run()
    await reapIdleEnvs()
    expect(getSessionRow(run.sessionId).envState).toBe('up')
    db.update(schema.sessions).set({ previewLastSeen: STALE }).where(eq(schema.sessions.id, run.sessionId)).run()
    await reapIdleEnvs()
    expect(getSessionRow(run.sessionId).envState).toBe('stopped')
  })
})
