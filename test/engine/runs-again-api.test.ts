import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { attachTestObject, makeProject, makeRun } from '../helpers/db'

vi.mock('#server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { db, schema } = await import('#server/db')
const handler = (await import('#server/api/runs/[id]/again.post')).default
const again = (runId: number) => callRoute(handler, { route: '/api/runs/:id/again', path: `/api/runs/${runId}/again` })

describe('POST /api/runs/:id/again', () => {
  const workflow = db.insert(schema.workflows).values({ name: 'runs-again-api', steps: [{ type: 'bash', command: 'true', id: 'run' }] }).returning().get()

  it('starts a new run in the same session with the inputs and object of the failed one', async () => {
    const project = makeProject()
    const failed = makeRun(project, [], { workflowId: workflow.id, status: 'failed', trigger: 'jira', inputs: { title: 'Fix it' }, actor: { id: 'u1', name: 'Ann' } })
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
      steps: [{ type: 'bash', command: 'true', id: 'run' }],
    })
    expect((res.json as { id: number }).id).not.toBe(failed.id)
  })

  it('refuses while something runs in the session', async () => {
    const project = makeProject()
    const failed = makeRun(project, [], { workflowId: workflow.id, status: 'failed' })
    makeRun(project, [], { sessionId: failed.sessionId, workflowId: workflow.id, status: 'running' })

    const res = await again(failed.id)

    expect(res.status).toBe(409)
  })

  it('refuses a run that has not failed', async () => {
    const project = makeProject()
    const done = makeRun(project, [], { workflowId: workflow.id, status: 'success' })

    const res = await again(done.id)

    expect(res.status).toBe(409)
  })
})
