import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '#server/db'
import { attachTestObject, makeProject, makeRun } from '../helpers/db'
import { callRoute } from '../helpers/routes'

const tornDown: number[] = []
vi.mock('#server/daemon/envs', () => ({
  deleteEnv: async (sessionId: number) => { tornDown.push(sessionId) },
}))
const cancelled: number[] = []
vi.mock('#server/daemon/runner', () => ({
  cancelRun: (runId: number) => { cancelled.push(runId) },
}))
vi.mock('#server/daemon/followups', () => ({ cancelFollowupWork: () => 0 }))

const handler = (await import('#server/api/sessions/[id].delete')).default

describe('DELETE /api/sessions/:id', () => {
  it('deletes the session with every run, its rows and its environment', async () => {
    const project = makeProject()
    const first = makeRun(project, [], { status: 'success' })
    const sessionId = first.sessionId
    const second = makeRun(project, [], { sessionId, status: 'running' })
    const other = makeRun(project, [], { status: 'success' })
    db.insert(schema.runSteps).values({ runId: second.id, stepIndex: 0, stepId: 'boot', type: 'ddev-start', status: 'running' }).run()
    db.insert(schema.followups).values({ sessionId, runId: first.id, prompt: 'again', origin: 'followup', status: 'success' }).run()
    attachTestObject(sessionId, { integration: 'github', kind: 'issue', key: '7', url: null, title: null, status: 'open' })

    const res = await callRoute(handler, { method: 'DELETE', route: '/sessions/:id', path: `/sessions/${sessionId}` })

    expect(res.status).toBe(200)
    expect(cancelled).toEqual(expect.arrayContaining([first.id, second.id]))
    expect(tornDown).toEqual([sessionId])
    expect(db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()).toBeUndefined()
    expect(db.select().from(schema.runs).where(eq(schema.runs.sessionId, sessionId)).all()).toEqual([])
    expect(db.select().from(schema.runSteps).where(eq(schema.runSteps.runId, second.id)).all()).toEqual([])
    expect(db.select().from(schema.followups).where(eq(schema.followups.sessionId, sessionId)).all()).toEqual([])
    expect(db.select().from(schema.sessionObjects).where(eq(schema.sessionObjects.sessionId, sessionId)).all()).toEqual([])
    expect(db.select().from(schema.runs).where(eq(schema.runs.id, other.id)).get()).toBeDefined()
  })
})
