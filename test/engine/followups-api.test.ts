import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { makeProject, makeRun } from '../helpers/db'

const started: number[] = []
vi.mock('../../server/daemon/followups', () => ({
  startFollowup: async (id: number) => {
    started.push(id)
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))
Object.assign(globalThis, { requireUserSession: async () => ({ user: { login: 'samuelreichor' } }) })

const { db, schema } = await import('../../server/db')
const handler = (await import('../../server/api/runs/[id]/followups.post')).default

function post(runId: number) {
  return callRoute(handler, { route: '/runs/:id/followups', path: `/runs/${runId}/followups`, body: { prompt: 'more' } })
}

function liveRun(status: 'success' | 'failed' | 'running' | 'queued' | 'cancelled', envState: 'up' | 'stopped' | 'down' = 'up') {
  const run = makeRun(makeProject(), [], { status })
  db.update(schema.sessions).set({ envState }).where(eq(schema.sessions.id, run.sessionId)).run()
  return run
}

describe('POST /api/runs/:id/followups', () => {
  it('queues a follow-up while the run is still running, for the dispatcher to start later', async () => {
    const run = liveRun('running')
    const res = await post(run.id)
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ status: 'queued', runId: run.id, requestedBy: 'samuelreichor' })
    expect(started).not.toContain((res.json as { id: number }).id)
  })

  it('accepts a queued run whose environment does not exist yet', async () => {
    const res = await post(liveRun('queued', 'down').id)
    expect(res.status).toBe(200)
  })

  it('starts right away on a finished run with a live environment, but not behind queued work', async () => {
    const run = liveRun('success')
    const first = await post(run.id)
    expect(started).toContain((first.json as { id: number }).id)
    const second = await post(run.id)
    expect(second.status).toBe(200)
    expect(started).not.toContain((second.json as { id: number }).id)
  })

  it('refuses cancelled runs and finished runs whose environment is gone', async () => {
    expect((await post(liveRun('cancelled').id)).status).toBe(409)
    expect((await post(liveRun('success', 'down').id)).status).toBe(409)
  })
})
