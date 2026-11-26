import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { attachTestObject, makeProject, makeRun } from '../helpers/db'

vi.mock('#server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))
const stopRunProcesses = vi.hoisted(() => vi.fn(async (_sessionId: number, _runId: number) => true))
vi.mock('#server/daemon/session-sandbox', () => ({ stopRunProcesses }))

const { db, schema } = await import('#server/db')
const handler = (await import('#server/api/runs/[id]/again.post')).default
const again = (runId: number) => callRoute(handler, { route: '/api/runs/:id/again', path: `/api/runs/${runId}/again` })

describe('POST /api/runs/:id/again', () => {
  const workflow = db.insert(schema.workflows).values({ name: 'runs-again-api', steps: [{ type: 'bash', command: 'true', id: 'run' }] }).returning().get()

  it('starts a new run in the same session with the inputs and object of the failed one', async () => {
    const project = makeProject()
    const failed = makeRun(project, [], { workflowId: workflow.id, status: 'failed', trigger: 'jira', inputs: { title: 'Fix it' }, actor: { id: 'u1', name: 'Ann' }, startSha: 'a1b2c3', endSha: 'd4e5f6' })
    const object = attachTestObject(failed.sessionId, { integration: 'jira', kind: 'issue', key: 'PROJ-1' })
    db.update(schema.runs).set({ objectId: object.id }).where(eq(schema.runs.id, failed.id)).run()

    const res = await again(failed.id)

    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({
      sessionId: failed.sessionId,
      workflowId: workflow.id,
      status: 'queued',
      trigger: 'manual',
      objectId: object.id,
      inputs: { title: 'Fix it' },
      actor: { id: 'u1', name: 'Ann' },
      resetCheckout: true,
      startSha: 'a1b2c3',
      endSha: 'd4e5f6',
      steps: [{ type: 'bash', command: 'true', id: 'run' }],
    })
    expect((res.json as { id: number }).id).not.toBe(failed.id)
  })

  it('stops what the failed attempt left running before the new run is queued', async () => {
    const project = makeProject()
    const failed = makeRun(project, [], { workflowId: workflow.id, status: 'failed' })
    let runsWhileStopping = 0
    stopRunProcesses.mockImplementationOnce(async () => {
      runsWhileStopping = db.select().from(schema.runs).where(eq(schema.runs.sessionId, failed.sessionId)).all().length
      return true
    })

    const res = await again(failed.id)

    expect(res.status).toBe(200)
    expect(stopRunProcesses).toHaveBeenCalledWith(failed.sessionId, failed.id)
    expect(runsWhileStopping).toBe(1)
  })

  it('refuses while a process of the failed attempt survives', async () => {
    const project = makeProject()
    const failed = makeRun(project, [], { workflowId: workflow.id, status: 'cancelled' })
    stopRunProcesses.mockResolvedValueOnce(false)

    const res = await again(failed.id)

    expect(res.status).toBe(409)
    expect(db.select().from(schema.runs).where(eq(schema.runs.sessionId, failed.sessionId)).all()).toHaveLength(1)
  })

  it('refuses while something runs in the session', async () => {
    const project = makeProject()
    const failed = makeRun(project, [], { workflowId: workflow.id, status: 'failed' })
    makeRun(project, [], { sessionId: failed.sessionId, workflowId: workflow.id, status: 'running' })

    stopRunProcesses.mockClear()

    const res = await again(failed.id)

    expect(res.status).toBe(409)
    expect(stopRunProcesses).not.toHaveBeenCalled()
  })

  it('refuses a run that has not failed', async () => {
    const project = makeProject()
    const done = makeRun(project, [], { workflowId: workflow.id, status: 'success' })

    const res = await again(done.id)

    expect(res.status).toBe(409)
  })
})
