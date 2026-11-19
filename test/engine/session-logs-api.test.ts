import { describe, expect, it } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject, makeRun, makeSession } from '../helpers/db'
import { appendRunLog } from '#server/stores/runs'

const handler = (await import('#server/api/sessions/[id]/logs.get')).default

function get(sessionId: number) {
  return callRoute(handler, { method: 'GET', route: '/sessions/:id/logs', path: `/sessions/${sessionId}/logs` })
}

describe('GET /api/sessions/:id/logs', () => {
  it('returns the log of every workflow run in the session, oldest first, without mention runs', async () => {
    const project = makeProject()
    const session = makeSession(project)
    const first = makeRun(project, [], { sessionId: session.id })
    makeRun(project, [], { sessionId: session.id, kind: 'mention' })
    const second = makeRun(project, [], { sessionId: session.id })
    makeRun(project, [])
    appendRunLog(first.id, 'one\n')
    appendRunLog(second.id, 'two\n')

    const res = await get(session.id)
    expect(res.status).toBe(200)
    expect(res.json).toEqual([
      { runId: first.id, log: 'one\n', steps: [] },
      { runId: second.id, log: 'two\n', steps: [] },
    ])
  })

  it('answers 404 for an unknown session', async () => {
    expect((await get(999999)).status).toBe(404)
  })
})
