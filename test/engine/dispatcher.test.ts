import { describe, expect, it, vi } from 'vitest'
import { makeProject, makeRun } from '../helpers/db'

// The dispatcher's per-session serialization (ADR 0006): a session executes
// at most one run/follow-up at a time; concurrency slots go to OTHER
// sessions instead.

interface Deferred { resolve: () => void }
const started: number[] = []
const running = new Map<number, Deferred>()

vi.mock('../../server/daemon/runner', () => ({
  startRun: (runId: number) => {
    started.push(runId)
    return new Promise<void>((resolve) => {
      running.set(runId, { resolve })
    })
  },
}))
const startedFollowups: number[] = []
vi.mock('../../server/daemon/followups', () => ({
  // Flip the row like the real executor's claim does: the .finally()
  // re-dispatch must not find it 'queued' again (endless loop otherwise).
  startFollowup: async (id: number) => {
    startedFollowups.push(id)
    const { db, schema } = await import('../../server/db')
    const { eq } = await import('drizzle-orm')
    db.update(schema.followups).set({ status: 'success' }).where(eq(schema.followups.id, id)).run()
  },
}))

const { dispatchRuns } = await import('../../server/daemon/dispatcher')

async function finish(runId: number) {
  const { db, schema } = await import('../../server/db')
  const { eq } = await import('drizzle-orm')
  db.update(schema.runs).set({ status: 'success' }).where(eq(schema.runs.id, runId)).run()
  running.get(runId)!.resolve()
  running.delete(runId)
  // Let the .finally() re-dispatch settle.
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('dispatchRuns per-session serialization', () => {
  it('never runs two runs of one session at once, but fills slots with other sessions', async () => {
    const project = makeProject()
    const first = makeRun(project, [])
    // Second run in the SAME session (a later trigger firing on the object).
    const second = makeRun(project, [], { sessionId: first.sessionId })
    // A run of a different session competes fairly.
    const other = makeRun(project, [])

    dispatchRuns()
    // Slot limit is 2 (default): the same-session run must NOT be picked even
    // though a slot is free for it; the other session takes it.
    expect(started).toEqual([first.id, other.id])

    await finish(first.id)
    expect(started).toEqual([first.id, other.id, second.id])
    await finish(other.id)
    await finish(second.id)
  })

  it('a mention run goes to its follow-up, never the runner, and never blocks it', async () => {
    const { db, schema } = await import('../../server/db')
    const project = makeProject()
    const run = makeRun(project, [], { kind: 'mention', workflow: 'Mention', trigger: 'mention' })
    const followup = db.insert(schema.followups).values({
      sessionId: run.sessionId,
      runId: run.id,
      prompt: 'do it',
      origin: 'mention',
    }).returning({ id: schema.followups.id }).get()

    dispatchRuns()
    expect(started).not.toContain(run.id)
    expect(startedFollowups).toContain(followup.id)
  })
})
