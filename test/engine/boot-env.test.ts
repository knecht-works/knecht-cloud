import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { ActionRuntime } from '../../server/workflows/actions'
import type { Project } from '../../server/db/schema'
import { getSessionRow, makeProject, makeSession } from '../helpers/db'

const calls: string[] = []
const failing = new Set<string>()
const startEnvStack = vi.fn(async (_sessionId: number, _log?: (text: string) => void) => {
  calls.push('ddev start')
})
const stopEnvStack = vi.fn(async (_sessionId: number) => {
  calls.push('ddev stop')
})
vi.mock('../../server/daemon/sandbox', () => ({
  envStackRunning: async () => true,
  execInSandbox: async () => ({ stdout: '' }),
  forgetPreview: () => {},
  removeEnvStack: async () => {},
  startEnvStack: (sessionId: number, log?: (text: string) => void) => startEnvStack(sessionId, log),
  stopEnvStack: (sessionId: number) => stopEnvStack(sessionId),
  streamInSandbox: async (_sessionId: number, command: string[]) => {
    const line = command.join(' ')
    calls.push(line)
    return { code: failing.has(line) ? 1 : 0, tail: '' }
  },
}))
vi.mock('../../server/daemon/workspace', () => ({
  ensureWorkspaceUp: async () => { calls.push('workspace up') },
  removeWorkspace: async () => { calls.push('workspace removed') },
}))
const waitForDevServer = vi.fn(async (_sessionId: number, _port: number) => {})
vi.mock('../../server/daemon/dev-server', () => ({
  restartDevServer: async (exec: (command: string[]) => Promise<number>) => {
    await exec(['supervisorctl', 'restart', 'webextradaemons:*'])
  },
  waitForDevServer: (sessionId: number, port: number) => waitForDevServer(sessionId, port),
}))

const { db, schema } = await import('../../server/db')
const { archiveEnv, bootEnv, reviveEnv } = await import('../../server/daemon/envs')
const { ddevStartAction } = await import('../../server/workflows/actions/ddev-start')

function freshSession(project: Project) {
  return makeSession(project, { previewPort: 3000 })
}

beforeEach(() => {
  calls.length = 0
  failing.clear()
  startEnvStack.mockClear()
  stopEnvStack.mockClear()
  waitForDevServer.mockReset()
})

describe('bootEnv', () => {
  it('starts once, then imports, runs the boot commands and waits for the dev server', async () => {
    const session = freshSession(makeProject())
    await bootEnv(session.id, { dbFile: '/dumps/db.sql.gz', projectCommands: 'pnpm install', stepCommands: 'pnpm run build' })
    expect(calls).toEqual([
      'workspace removed',
      'ddev start',
      'ddev import-db --file=/dumps/db.sql.gz',
      'bash -lc pnpm install',
      'bash -lc pnpm run build',
      'supervisorctl restart webextradaemons:*',
    ])
    expect(waitForDevServer).toHaveBeenCalledWith(session.id, 3000)
  })

  it('stops the stack and leaves the session a code session when a boot command fails', async () => {
    const session = freshSession(makeProject())
    failing.add('bash -lc pnpm install')
    await expect(bootEnv(session.id, { dbFile: null, projectCommands: 'pnpm install' })).rejects.toThrow('exited with code 1')
    expect(calls.at(-1)).toBe('ddev stop')
    expect(getSessionRow(session.id).tier).toBe('code')
  })

  it('stops the stack when the dev server never answers', async () => {
    const session = freshSession(makeProject())
    db.update(schema.sessions).set({ envState: 'archived' }).where(eq(schema.sessions.id, session.id)).run()
    waitForDevServer.mockRejectedValueOnce(new Error('did not answer'))
    await expect(bootEnv(session.id, { dbFile: null, projectCommands: '' })).rejects.toThrow('did not answer')
    expect(stopEnvStack).toHaveBeenCalledWith(session.id)
    expect(getSessionRow(session.id).envState).toBe('archived')
  })
})

describe('ddev-start action', () => {
  it('boots a code session with a single ddev start and promotes it to preview', async () => {
    const project = makeProject({ bootCommands: 'pnpm install' })
    const session = freshSession(project)
    db.update(schema.sessions).set({ envState: 'up' }).where(eq(schema.sessions.id, session.id)).run()
    const ensureUp = vi.fn(async () => {})
    const rt = {
      sessionId: session.id,
      project,
      checkoutDir: '/nonexistent',
      log: () => {},
      signal: new AbortController().signal,
      sandbox: { ensureUp },
    } as unknown as ActionRuntime
    await ddevStartAction.run({ type: 'ddev-start' }, rt)
    expect(ensureUp).not.toHaveBeenCalled()
    expect(startEnvStack).toHaveBeenCalledTimes(1)
    expect(getSessionRow(session.id).tier).toBe('preview')
  })

  it('only revives a session that is already a preview', async () => {
    const project = makeProject({ bootCommands: 'pnpm install' })
    const session = makeSession(project)
    db.update(schema.sessions).set({ envState: 'up', tier: 'preview' }).where(eq(schema.sessions.id, session.id)).run()
    const ensureUp = vi.fn(async () => {})
    const rt = {
      sessionId: session.id,
      project,
      checkoutDir: '/nonexistent',
      log: () => {},
      signal: new AbortController().signal,
      sandbox: { ensureUp },
    } as unknown as ActionRuntime
    await ddevStartAction.run({ type: 'ddev-start' }, rt)
    expect(ensureUp).toHaveBeenCalledTimes(1)
    expect(startEnvStack).not.toHaveBeenCalled()
  })
})

describe('reviveEnv', () => {
  it('brings a stopped code session back in its workspace without touching ddev', async () => {
    const session = makeSession(makeProject())
    db.update(schema.sessions).set({ envState: 'stopped' }).where(eq(schema.sessions.id, session.id)).run()
    await reviveEnv(session.id)
    expect(calls).toEqual(['workspace removed', 'workspace up'])
    expect(startEnvStack).not.toHaveBeenCalled()
    expect(getSessionRow(session.id).envState).toBe('up')
  })

  it('restarts the ddev stack of a stopped preview', async () => {
    const session = makeSession(makeProject())
    db.update(schema.sessions).set({ envState: 'stopped', tier: 'preview' }).where(eq(schema.sessions.id, session.id)).run()
    await reviveEnv(session.id)
    expect(calls).toEqual(['ddev start'])
    expect(getSessionRow(session.id).envState).toBe('up')
  })

  it('runs an up code session in its workspace and never starts ddev for it', async () => {
    const session = makeSession(makeProject())
    db.update(schema.sessions).set({ envState: 'up' }).where(eq(schema.sessions.id, session.id)).run()
    await reviveEnv(session.id)
    expect(calls).toEqual(['workspace up'])
    expect(startEnvStack).not.toHaveBeenCalled()
  })

  it('refuses a session without a checkout', async () => {
    const session = makeSession(makeProject())
    await expect(reviveEnv(session.id)).rejects.toThrow('no checkout')
    expect(calls).toEqual([])
  })
})

describe('archiveEnv', () => {
  it('leaves a session alone that was revived after the reaper listed it', async () => {
    const session = makeSession(makeProject())
    db.update(schema.sessions).set({ envState: 'up' }).where(eq(schema.sessions.id, session.id)).run()
    await archiveEnv(session.id)
    expect(calls).toEqual([])
    expect(getSessionRow(session.id).envState).toBe('up')
  })
})
