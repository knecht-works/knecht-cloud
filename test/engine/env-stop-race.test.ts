import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { getSessionRow, makeProject, makeRun, makeSession } from '../helpers/db'

const stack = vi.hoisted(() => ({ running: new Set<number>(), release: null as null | (() => void) }))
const startEnvStack = vi.fn(async (sessionId: number) => {
  await new Promise<void>((resolve) => {
    stack.release = resolve
  })
  stack.running.add(sessionId)
})
const stopEnvStack = vi.fn(async (sessionId: number) => {
  stack.running.delete(sessionId)
})
vi.mock('#server/daemon/sandbox', () => ({
  envStackRunning: async (sessionId: number) => stack.running.has(sessionId),
  forgetPreview: () => {},
  removeEnvStack: async () => {},
  startEnvStack: (sessionId: number) => startEnvStack(sessionId),
  stopEnvStack: (sessionId: number) => stopEnvStack(sessionId),
}))
const removeWorkspace = vi.fn(async (_sessionId: number) => {})
vi.mock('#server/daemon/workspace', () => ({
  ensureWorkspaceUp: async () => {},
  removeWorkspace: (sessionId: number) => removeWorkspace(sessionId),
}))

const { reviveEnv, stopEnv } = await import('#server/daemon/envs')
const stopHandler = (await import('#server/api/runs/[id]/stop.post')).default

function previewRun(envState: 'up' | 'stopped') {
  const project = makeProject()
  return makeRun(project, [], { status: 'success', sessionId: makeSession(project, { envState, tier: 'preview' }).id })
}

beforeEach(() => {
  stack.running.clear()
  stack.release = null
  startEnvStack.mockClear()
  stopEnvStack.mockClear()
  removeWorkspace.mockClear()
})

describe('stopping while the environment starts', () => {
  it('stops the stack a concurrent start creates instead of marking it stopped beside running containers', async () => {
    const { sessionId } = previewRun('up')
    const starting = reviveEnv(sessionId)
    await vi.waitFor(() => expect(stack.release).not.toBeNull())
    const stopping = stopEnv(sessionId, { byHand: true })
    stack.release!()
    await starting
    await stopping
    expect(getSessionRow(sessionId).envState).toBe('stopped')
    expect(stack.running.has(sessionId)).toBe(false)
  })

  it('lets a run reapply a changed environment only through the same guard', async () => {
    const { applyEnvDefinition } = await import('#server/daemon/envs')
    const { sessionId } = previewRun('up')
    stack.running.add(sessionId)
    const applying = applyEnvDefinition(sessionId, () => {})
    await vi.waitFor(() => expect(stack.release).not.toBeNull())
    const stopping = stopEnv(sessionId)
    stack.release!()
    await applying
    await stopping
    expect(getSessionRow(sessionId).envState).toBe('stopped')
    expect(stack.running.has(sessionId)).toBe(false)
  })
})

describe('POST /api/runs/:id/stop', () => {
  it('stops the containers of a session the dashboard already shows as stopped', async () => {
    const run = previewRun('stopped')
    stack.running.add(run.sessionId)
    const res = await callRoute(stopHandler, { method: 'POST', route: '/runs/:id/stop', path: `/runs/${run.id}/stop` })
    expect(res.status).toBe(200)
    expect(stopEnvStack).toHaveBeenCalledWith(run.sessionId)
    expect(stack.running.has(run.sessionId)).toBe(false)
    expect(getSessionRow(run.sessionId).envState).toBe('stopped')
  })
})
