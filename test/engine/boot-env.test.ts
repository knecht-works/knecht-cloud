import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { ActionRuntime } from '../../server/workflows/actions'
import type { Project } from '../../server/db/schema'
import { getSessionRow, makeProject, makeRun, makeSession } from '../helpers/db'

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
  execInSandbox: async (_sessionId: number, command: string[]) => {
    calls.push(command.join(' '))
    return { stdout: '' }
  },
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
vi.mock('../../server/daemon/db-base', () => ({
  archiveDbVolume: async () => { calls.push('archive db volume') },
  archivedDbVolume: () => null,
  cloneDbBase: async (_sessionId: number, base: { volume: string }) => { calls.push(`clone ${base.volume}`) },
  readyDbBase: async () => null,
  restoreDbVolume: async (_sessionId: number, archive: string) => { calls.push(`restore ${archive}`) },
}))
const waitForDevServer = vi.fn(async (_sessionId: number, _port: number) => {})
vi.mock('../../server/daemon/dev-server', () => ({
  restartDevServer: async (exec: (command: string[]) => Promise<number>) => {
    await exec(['supervisorctl', 'restart', 'webextradaemons:*'])
  },
  waitForDevServer: (sessionId: number, port: number) => waitForDevServer(sessionId, port),
}))

const { db, schema } = await import('../../server/db')
const { archiveEnv, bootEnv, rehydrateEnv, reviveEnv, stopEnv } = await import('../../server/daemon/envs')
const { sessionCheckoutDir } = await import('../../server/utils/storage')
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

  it('copies the project\'s base database before ddev starts instead of importing', async () => {
    const session = freshSession(makeProject())
    await bootEnv(session.id, { dbFile: null, dbBase: { volume: 'knecht-base-1-x-mariadb', database: 'mariadb:11.8' }, projectCommands: 'pnpm install' })
    expect(calls).toEqual([
      'workspace removed',
      'clone knecht-base-1-x-mariadb',
      'ddev start',
      'bash -lc pnpm install',
      'supervisorctl restart webextradaemons:*',
    ])
  })

  it('restores an archived database volume ahead of a base or a dump', async () => {
    const session = freshSession(makeProject())
    await bootEnv(session.id, { dbFile: null, dbArchive: '/archives/db-mariadb.tar.gz', projectCommands: '' })
    expect(calls.slice(0, 3)).toEqual(['workspace removed', 'restore /archives/db-mariadb.tar.gz', 'ddev start'])
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

  function sessionThatBooted(envState: 'up' | 'stopped') {
    const project = makeProject({ bootCommands: 'pnpm install' })
    const session = makeSession(project, { envState })
    const run = makeRun(project, [{ type: 'ddev-start', commands: 'pnpm run build' }], { sessionId: session.id })
    db.insert(schema.runSteps).values({ runId: run.id, stepIndex: 0, stepId: 'boot', type: 'ddev-start', status: 'success', params: { commands: 'pnpm run build' } }).run()
    return session
  }

  it.each(['up', 'stopped'] as const)('boots the lost preview of an %s code session that once had one', async (envState) => {
    const session = sessionThatBooted(envState)
    await reviveEnv(session.id)
    expect(calls).toEqual(['workspace removed', 'ddev start', 'bash -lc pnpm install', 'bash -lc pnpm run build'])
    expect(getSessionRow(session.id)).toMatchObject({ envState: 'up', tier: 'preview' })
  })

  it('refuses a session without a checkout', async () => {
    const session = makeSession(makeProject())
    await expect(reviveEnv(session.id)).rejects.toThrow('no checkout')
    expect(calls).toEqual([])
  })
})

describe('archive and restore', () => {
  function git(dir: string, ...args: string[]) {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
  }

  function stoppedCheckout(gitignore: string) {
    const session = makeSession(makeProject(), { envState: 'stopped' })
    const dir = sessionCheckoutDir(session.id)
    mkdirSync(join(dir, 'vendor'), { recursive: true })
    execFileSync('git', ['init', '-q', dir])
    git(dir, 'config', 'user.email', 'test@knecht.test')
    git(dir, 'config', 'user.name', 'test')
    writeFileSync(join(dir, '.gitignore'), gitignore)
    writeFileSync(join(dir, 'tracked.txt'), 'v1\n')
    writeFileSync(join(dir, 'vendor', 'lib.php'), 'lib\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'unpushed')
    return { session, dir }
  }

  it('restores the checkout byte for byte without running anything the sandbox planted in .git', async () => {
    const { session, dir } = stoppedCheckout('/vendor\n')
    const head = git(dir, 'rev-parse', 'HEAD')
    writeFileSync(join(dir, 'tracked.txt'), 'v2 uncommitted\n')
    writeFileSync(join(dir, 'untracked.txt'), 'new\n')
    mkdirSync(join(dir, '.knecht'))
    writeFileSync(join(dir, '.knecht', 'state.json'), '{}')

    const marker = join(dir, '..', `planted-${session.id}`)
    const plant = `#!/bin/sh\necho ran >> ${marker}\n`
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), plant, { mode: 0o755 })
    writeFileSync(join(dir, '.git', 'fsmonitor'), plant, { mode: 0o755 })
    git(dir, 'config', 'core.fsmonitor', join(dir, '.git', 'fsmonitor'))
    git(dir, 'config', 'filter.planted.clean', `sh -c 'echo ran >> ${marker}; cat'`)
    writeFileSync(join(dir, '.gitattributes'), '* filter=planted\n')
    rmSync(marker, { force: true })

    await archiveEnv(session.id)
    expect(getSessionRow(session.id).envState).toBe('archived')
    expect(existsSync(dir)).toBe(false)

    await rehydrateEnv(session.id)
    expect(existsSync(marker)).toBe(false)
    expect(readFileSync(join(dir, 'tracked.txt'), 'utf8')).toBe('v2 uncommitted\n')
    expect(readFileSync(join(dir, 'untracked.txt'), 'utf8')).toBe('new\n')
    expect(readFileSync(join(dir, '.knecht', 'state.json'), 'utf8')).toBe('{}')
    expect(existsSync(join(dir, 'vendor'))).toBe(false)
    expect(git(dir, '-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD')).toBe(head)
  })

  it('keeps a vendor directory the repo commits', async () => {
    const { session, dir } = stoppedCheckout('/vendor/*\n!/vendor/lib.php\n')
    await archiveEnv(session.id)
    await rehydrateEnv(session.id)
    expect(readFileSync(join(dir, 'vendor', 'lib.php'), 'utf8')).toBe('lib\n')
  })
})

describe('stopEnv', () => {
  it('stops a preview without exporting its database', async () => {
    const session = makeSession(makeProject())
    db.update(schema.sessions).set({ envState: 'up', tier: 'preview' }).where(eq(schema.sessions.id, session.id)).run()
    await stopEnv(session.id)
    expect(calls).toEqual(['ddev stop'])
    expect(getSessionRow(session.id).envState).toBe('stopped')
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
