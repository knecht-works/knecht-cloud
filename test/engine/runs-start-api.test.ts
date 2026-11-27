import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'

vi.mock('#server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { db, schema } = await import('#server/db')
const start = (await import('#server/api/runs/index.post')).default

function sessionOf(run: unknown) {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, (run as { sessionId: number }).sessionId)).get()!
}

describe('POST /api/runs', () => {
  const workflow = db.insert(schema.workflows).values({ name: 'runs-start-api', steps: [{ type: 'bash', command: 'true', id: 'run' }] }).returning().get()

  it('bases the session on the default branch unless a base is given', async () => {
    const project = makeProject()
    const plain = await callRoute(start, { body: { projectId: project.id, workflowId: workflow.id, branch: 'develop' } })
    expect(plain.status).toBe(200)
    expect(sessionOf(plain.json)).toMatchObject({ branch: 'develop', baseBranch: 'main' })

    const based = await callRoute(start, { body: { projectId: project.id, workflowId: workflow.id, branch: 'develop', base: 'develop' } })
    expect(sessionOf(based.json)).toMatchObject({ branch: 'develop', baseBranch: 'develop' })

    const baseOnly = await callRoute(start, { body: { projectId: project.id, workflowId: workflow.id, base: 'develop' } })
    expect(sessionOf(baseOnly.json)).toMatchObject({ branch: 'develop', baseBranch: 'develop' })
  })

  it('reads mock labels as a comma-separated list', async () => {
    const res = await callRoute(start, { body: { projectId: makeProject().id, workflowId: workflow.id, inputs: { title: 'Mock', labels: 'bug, qa-sonder ,' } } })
    expect(res.status).toBe(200)
    expect((res.json as { inputs: unknown }).inputs).toMatchObject({ event: 'manual', title: 'Mock', labels: ['bug', 'qa-sonder'] })
  })
})
