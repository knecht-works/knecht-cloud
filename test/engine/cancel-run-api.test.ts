import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject, makeRun } from '../helpers/db'

vi.mock('#server/daemon/runner', () => ({ cancelRun: () => {} }))
vi.mock('#server/integrations/assignee', () => ({ handBackObject: async () => {} }))

const { inMailbox, operationSignal } = await import('#server/daemon/session-env')
const handler = (await import('#server/api/runs/[id]/cancel.post')).default

function cancel(runId: number) {
  return callRoute(handler, { route: '/runs/:id/cancel', path: `/runs/${runId}/cancel` })
}

function rebootUnderWay(sessionId: number) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reboot = inMailbox(sessionId, 'rebooting', async () => {
    const signal = operationSignal(sessionId)
    await gate
    signal?.throwIfAborted()
    return 'done'
  })
  return { reboot, release }
}

describe('POST /api/runs/:id/cancel', () => {
  it('cancels the reboot the running run waits for', async () => {
    const run = makeRun(makeProject(), [], { status: 'running' })
    const { reboot, release } = rebootUnderWay(run.sessionId)
    expect((await cancel(run.id)).status).toBe(200)
    release()
    await expect(reboot).rejects.toThrow('cancelled')
  })

  it('leaves alone the reboot another run of the session is in the middle of', async () => {
    const project = makeProject()
    const running = makeRun(project, [], { status: 'running' })
    const queued = makeRun(project, [], { status: 'queued', sessionId: running.sessionId })
    const { reboot, release } = rebootUnderWay(running.sessionId)
    expect((await cancel(queued.id)).status).toBe(200)
    release()
    await expect(reboot).resolves.toBe('done')
  })
})
