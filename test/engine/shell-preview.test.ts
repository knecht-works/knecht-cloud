import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Step } from '#shared/utils/workflow'
import { getRun, getSessionRow, makeProject, makeRun, makeSession } from '../helpers/db'

vi.mock('#server/daemon/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#server/daemon/git')>()
  const { fakeCheckout } = await import('../helpers/local-sandbox')
  return { ...actual, prepareSessionCheckout: fakeCheckout }
})
vi.mock('#server/utils/github-app', () => ({
  getInstallationToken: async () => 'test-token',
  getBotIdentity: async () => ({ name: 'Knecht Test', email: 'test@knecht.works' }),
}))

const stack = vi.hoisted(() => ({ running: new Set<number>(), containers: [] as string[] }))
const startEnvStack = vi.hoisted(() => vi.fn(async (sessionId: number) => {
  stack.running.add(sessionId)
}))
vi.mock('#server/daemon/sandbox', async importOriginal => ({
  ...await importOriginal<typeof import('#server/daemon/sandbox')>(),
  envStackRunning: async (sessionId: number) => stack.running.has(sessionId),
  startEnvStack: (sessionId: number) => startEnvStack(sessionId),
  stopEnvStack: async (sessionId: number) => {
    stack.running.delete(sessionId)
  },
  streamInContainer: async (container: string) => {
    stack.containers.push(container)
    return { code: 0, tail: 'ok' }
  },
}))
const ensureWorkspaceUp = vi.hoisted(() => vi.fn(async (_sessionId: number) => {}))
const removeWorkspace = vi.hoisted(() => vi.fn(async (_sessionId: number) => {}))
vi.mock('#server/daemon/workspace', async importOriginal => ({
  ...await importOriginal<typeof import('#server/daemon/workspace')>(),
  ensureWorkspaceUp: (sessionId: number) => ensureWorkspaceUp(sessionId),
  removeWorkspace: (sessionId: number) => removeWorkspace(sessionId),
}))

const { startRun } = await import('#server/daemon/runner')
const { webContainerName } = await import('#server/daemon/sandbox')
const { workspaceContainerName } = await import('#server/daemon/workspace')

async function runOnStoppedPreview(step: Step) {
  const project = makeProject()
  const session = makeSession(project, { envState: 'stopped', tier: 'preview' })
  const run = makeRun(project, [step], { sessionId: session.id, status: 'queued' })
  await startRun(run.id, project)
  return { sessionId: session.id, run: getRun(run.id) }
}

beforeEach(() => {
  stack.running.clear()
  stack.containers.length = 0
  startEnvStack.mockClear()
  ensureWorkspaceUp.mockClear()
  removeWorkspace.mockClear()
})

describe('shell step and the preview', () => {
  it('runs a shell-only workflow on a stopped preview in a workspace and leaves no preview running', async () => {
    const { sessionId, run } = await runOnStoppedPreview({ type: 'bash', command: 'echo hi' })
    expect(run.status).toBe('success')
    expect(startEnvStack).not.toHaveBeenCalled()
    expect(stack.containers).toEqual([workspaceContainerName(sessionId)])
    expect(removeWorkspace).toHaveBeenCalledWith(sessionId)
    expect(getSessionRow(sessionId).envState).toBe('stopped')
  })

  it('boots the preview first when the step asks for it', async () => {
    const { sessionId, run } = await runOnStoppedPreview({ type: 'bash', command: 'ddev craft up', startPreview: true })
    expect(run.status).toBe('success')
    expect(startEnvStack).toHaveBeenCalledWith(sessionId)
    expect(stack.containers).toEqual([webContainerName(sessionId)])
    expect(getSessionRow(sessionId).envState).toBe('up')
  })

  it('uses a preview that already runs without starting anything', async () => {
    const project = makeProject()
    const session = makeSession(project, { envState: 'up', tier: 'preview' })
    stack.running.add(session.id)
    const run = makeRun(project, [{ type: 'bash', command: 'echo hi' }], { sessionId: session.id, status: 'queued' })
    await startRun(run.id, project)
    expect(getRun(run.id).status).toBe('success')
    expect(ensureWorkspaceUp).not.toHaveBeenCalled()
    expect(stack.containers).toEqual([webContainerName(session.id)])
  })
})
