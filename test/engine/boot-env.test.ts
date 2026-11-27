import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { ActionRuntime } from '#server/workflows/actions'
import type { Project } from '#server/db/schema'
import { getSessionRow, makeProject, makeRun, makeSession } from '../helpers/db'
import { remoteWithMain } from '../helpers/git-remote'

const calls: string[] = []
const envs = new Map<string, Record<string, string> | undefined>()
const failing = new Set<string>()
let onStream = (_line: string) => {}
const startEnvStack = vi.fn(async (_sessionId: number, _log?: (text: string) => void) => {
  calls.push('ddev start')
})
const stopEnvStack = vi.fn(async (_sessionId: number) => {
  calls.push('ddev stop')
})
vi.mock('#server/daemon/sandbox', () => ({
  envStackRunning: async () => true,
  execInSandbox: async (_sessionId: number, command: string[]) => {
    calls.push(command.join(' '))
    return { stdout: '' }
  },
  forgetPreview: () => {},
  removeEnvStack: async () => {},
  runTag: (runId: number) => ({ KNECHT_RUN_TAG: String(runId) }),
  startEnvStack: (sessionId: number, log?: (text: string) => void) => startEnvStack(sessionId, log),
  stopEnvStack: (sessionId: number) => stopEnvStack(sessionId),
  streamInSandbox: async (_sessionId: number, command: string[], _log: unknown, env?: Record<string, string>, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const line = command.join(' ')
    calls.push(line)
    envs.set(line, env)
    onStream(line)
    return { code: failing.has(line) ? 1 : 0, tail: '' }
  },
}))
vi.mock('#server/daemon/workspace', () => ({
  ensureWorkspaceUp: async () => { calls.push('workspace up') },
  removeWorkspace: async () => { calls.push('workspace removed') },
  // Runs on the host against the checkout the container would mount.
  runOnCheckout: async (sessionId: number, command: string[], input?: string) => {
    calls.push(`checkout ${sessionId}: ${command.join(' ')}`)
    const { sessionCheckoutDir } = await import('#server/utils/storage')
    execFileSync(command[0]!, command.slice(1), { cwd: sessionCheckoutDir(sessionId), input })
  },
}))
vi.mock('#server/daemon/db-base', () => ({
  archiveDbVolume: async () => { calls.push('archive db volume') },
  archivedDbVolume: () => null,
  cloneDbBase: async (_sessionId: number, base: { volume: string }) => { calls.push(`clone ${base.volume}`) },
  readyDbBase: async () => null,
  restoreDbVolume: async (_sessionId: number, archive: string) => { calls.push(`restore ${archive}`) },
}))
const waitForDevServer = vi.fn(async (_sessionId: number, _port: number, _signal?: AbortSignal) => {})
const noteDevServerUse = vi.fn(async (_sessionId: number, _log: (text: string) => void) => {})
const devServerOutput = vi.fn(async (_sessionId: number, _since: Date) => '')
vi.mock('#server/daemon/dev-server', () => ({
  devServerOutput: (sessionId: number, since: Date) => devServerOutput(sessionId, since),
  noteDevServerUse: (sessionId: number, log: (text: string) => void) => noteDevServerUse(sessionId, log),
  restartDevServer: async (exec: (command: string[]) => Promise<number>) => {
    if (await exec(['supervisorctl', 'restart', 'webextradaemons:*']) !== 0) throw new Error('Could not restart the dev server')
  },
  waitForDevServer: (sessionId: number, port: number, signal?: AbortSignal) => waitForDevServer(sessionId, port, signal),
}))

const origin = vi.hoisted(() => ({ url: '' }))
vi.mock('#server/git', async () => {
  const { credentialsFor } = await import('../helpers/git-remote')
  return { gitProvider: () => ({ credentials: async () => credentialsFor(origin.url) }) }
})
vi.mock('#server/utils/github-app', () => ({
  getBotIdentity: async () => ({ name: 'Knecht Test', email: 'test@knecht.works' }),
}))

const { db, schema } = await import('#server/db')
const { archiveEnv, bootEnv, deleteEnv, envTransition, rebootEnv, rehydrateEnv, releaseWorkspace, reviveEnv, reviveWithoutPreview, stopEnv } = await import('#server/daemon/envs')
const { cancelOperation, inMailbox, OperationCancelled, SessionGone } = await import('#server/daemon/session-env')
const { sessionArchiveDir, sessionCheckoutDir } = await import('#server/utils/storage')
const { ddevStartAction } = await import('#server/workflows/actions/ddev-start')

function freshSession(project: Project) {
  return makeSession(project, { previewPort: 3000, envState: 'up' })
}

beforeEach(() => {
  calls.length = 0
  envs.clear()
  failing.clear()
  onStream = () => {}
  startEnvStack.mockClear()
  stopEnvStack.mockClear()
  waitForDevServer.mockReset()
  devServerOutput.mockReset()
})

describe('bootEnv', () => {
  it('starts once, then imports, runs the boot commands, waits for the dev server and only then removes the workspace', async () => {
    const session = freshSession(makeProject())
    await bootEnv(session.id, { dbFile: '/dumps/db.sql.gz', projectCommands: 'pnpm install', stepCommands: 'pnpm run build' })
    expect(calls).toEqual([
      'ddev start',
      'ddev import-db --file=/dumps/db.sql.gz',
      'bash -lc pnpm install',
      'bash -lc pnpm run build',
      'supervisorctl restart webextradaemons:*',
      'workspace removed',
    ])
    expect(waitForDevServer).toHaveBeenCalledWith(session.id, 3000, undefined)
    expect(noteDevServerUse).toHaveBeenCalledWith(session.id, expect.any(Function))
  })

  it('tags the boot commands with the run, so a cancel finds them, but not the dev server', async () => {
    const session = freshSession(makeProject())
    await bootEnv(session.id, { dbFile: '/dumps/db.sql.gz', projectCommands: 'pnpm install', stepCommands: 'pnpm run build', runId: 42 })
    const tag = { KNECHT_RUN_TAG: '42' }
    expect(envs.get('ddev import-db --file=/dumps/db.sql.gz')).toEqual(tag)
    expect(envs.get('bash -lc pnpm install')).toEqual(tag)
    expect(envs.get('bash -lc pnpm run build')).toEqual(tag)
    expect(envs.get('supervisorctl restart webextradaemons:*')).toBeUndefined()
  })

  it('copies the project\'s base database before ddev starts instead of importing', async () => {
    const session = freshSession(makeProject())
    await bootEnv(session.id, { dbFile: null, dbBase: { volume: 'knecht-base-1-x-mariadb', database: 'mariadb:11.8' }, projectCommands: 'pnpm install' })
    expect(calls).toEqual([
      'clone knecht-base-1-x-mariadb',
      'ddev start',
      'bash -lc pnpm install',
      'supervisorctl restart webextradaemons:*',
      'workspace removed',
    ])
  })

  it('restores an archived database volume ahead of a base or a dump', async () => {
    const session = freshSession(makeProject())
    await bootEnv(session.id, { dbFile: null, dbArchive: '/archives/db-mariadb.tar.gz', projectCommands: '' })
    expect(calls.slice(0, 2)).toEqual(['restore /archives/db-mariadb.tar.gz', 'ddev start'])
  })

  it('stops the stack and leaves the session a code session when a boot command fails', async () => {
    const session = freshSession(makeProject())
    failing.add('bash -lc pnpm install')
    await expect(bootEnv(session.id, { dbFile: null, projectCommands: 'pnpm install' })).rejects.toThrow('exited with code 1')
    expect(calls.slice(-2)).toEqual(['ddev stop', 'workspace removed'])
    expect(getSessionRow(session.id).tier).toBe('code')
  })

  it('starts no further boot command once the run is cancelled', async () => {
    const session = freshSession(makeProject())
    const cancel = new AbortController()
    // A cancelled `docker exec` client can still report exit code 0.
    onStream = (line) => {
      if (line === 'bash -lc ddev npm install') cancel.abort()
    }
    const log: string[] = []
    await expect(bootEnv(session.id, { dbFile: null, projectCommands: 'ddev npm install\nddev craft up', log: text => log.push(text), signal: cancel.signal })).rejects.toThrow()
    expect(calls).not.toContain('bash -lc ddev craft up')
    expect(log.join('')).not.toContain('ddev craft up')
    expect(calls.at(-1)).toBe('ddev stop')
  })

  it('shows the environment as stopping as soon as the run is cancelled', async () => {
    const session = freshSession(makeProject())
    const cancel = new AbortController()
    let seen: string | null = null
    onStream = (line) => {
      if (line !== 'bash -lc pnpm install') return
      cancel.abort()
      seen = envTransition(session.id)
    }
    await expect(inMailbox(session.id, 'booting', () => bootEnv(session.id, { dbFile: null, projectCommands: 'pnpm install', signal: cancel.signal }))).rejects.toThrow()
    expect(seen).toBe('stopping')
    expect(envTransition(session.id)).toBeNull()
  })

  it('stops a session only after the boot under way finished', async () => {
    const session = freshSession(makeProject())
    let stop: Promise<void> | undefined
    onStream = (line) => {
      if (line === 'bash -lc pnpm install') stop = stopEnv(session.id)
    }
    await inMailbox(session.id, 'booting', () => bootEnv(session.id, { dbFile: null, projectCommands: 'pnpm install' }))
    expect(getSessionRow(session.id).envState).toBe('up')
    await stop
    expect(calls.at(-1)).toBe('ddev stop')
    expect(getSessionRow(session.id).envState).toBe('stopped')
  })

  it('stops the stack when the run is cancelled while the dev server starts', async () => {
    const session = freshSession(makeProject())
    const cancel = new AbortController()
    noteDevServerUse.mockClear()
    waitForDevServer.mockImplementationOnce(async (_sessionId, _port, signal) => {
      cancel.abort()
      signal?.throwIfAborted()
    })
    await expect(bootEnv(session.id, { dbFile: null, projectCommands: '', signal: cancel.signal })).rejects.toThrow()
    expect(stopEnvStack).toHaveBeenCalledWith(session.id)
    expect(noteDevServerUse).not.toHaveBeenCalled()
  })

  it('stops the stack when the dev server never answers', async () => {
    const session = freshSession(makeProject())
    db.update(schema.sessions).set({ envState: 'archived' }).where(eq(schema.sessions.id, session.id)).run()
    waitForDevServer.mockRejectedValueOnce(new Error('did not answer'))
    await expect(bootEnv(session.id, { dbFile: null, projectCommands: '' })).rejects.toThrow('did not answer')
    expect(stopEnvStack).toHaveBeenCalledWith(session.id)
    expect(getSessionRow(session.id).envState).toBe('archived')
  })

  it.each([
    ['exits right away', () => { failing.add('supervisorctl restart webextradaemons:*') }],
    ['never answers', () => { waitForDevServer.mockRejectedValueOnce(new Error('did not answer')) }],
  ])('logs the dev server\'s own output when it %s', async (_case, breakDevServer) => {
    const session = freshSession(makeProject())
    breakDevServer()
    devServerOutput.mockResolvedValueOnce('Error: Request failed with status 403: rate limit exceeded\n')
    const log: string[] = []
    await expect(bootEnv(session.id, { dbFile: null, projectCommands: '', log: text => log.push(text) })).rejects.toThrow()
    expect(devServerOutput).toHaveBeenCalledWith(session.id, expect.any(Date))
    expect(log.join('')).toContain('rate limit exceeded')
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

  function bootStep(project: Project, sessionId: number, signal: AbortSignal, log: (text: string) => void = () => {}) {
    const rt = {
      sessionId,
      project,
      checkoutDir: '/nonexistent',
      log,
      signal,
      sandbox: { ensureUp: async () => {} },
    } as unknown as ActionRuntime
    return ddevStartAction.run({ type: 'ddev-start' }, rt)
  }

  it('leaves the session stopped, not up, when a boot command is killed (exit 137)', async () => {
    const project = makeProject({ bootCommands: 'ddev npm run build' })
    const session = freshSession(project)
    failing.add('bash -lc ddev npm run build')
    await expect(bootStep(project, session.id, new AbortController().signal)).rejects.toThrow()
    expect(calls.slice(-2)).toEqual(['ddev stop', 'workspace removed'])
    expect(getSessionRow(session.id)).toMatchObject({ envState: 'stopped', tier: 'code', wakeOnVisit: false })
  })

  it('leaves an up code session as it was when the run is cancelled mid-boot', async () => {
    const project = makeProject({ bootCommands: 'ddev npm run build' })
    const session = freshSession(project)
    const cancel = new AbortController()
    onStream = (line) => {
      if (line === 'bash -lc ddev npm run build') cancel.abort()
    }
    const log: string[] = []
    await expect(bootStep(project, session.id, cancel.signal, text => log.push(text))).rejects.toThrow()
    expect(calls.at(-1)).toBe('ddev stop')
    expect(calls).not.toContain('workspace removed')
    expect(getSessionRow(session.id)).toMatchObject({ envState: 'up', tier: 'code', envOperation: null })
    expect(log.join('')).toContain('Boot cancelled, the environment is back to how it was')
  })

  it('promotes the session when a retry boots it after the first attempt failed', async () => {
    const project = makeProject({ bootCommands: 'ddev npm run build' })
    const session = freshSession(project)
    db.update(schema.sessions).set({ envState: 'up' }).where(eq(schema.sessions.id, session.id)).run()
    const rt = {
      sessionId: session.id,
      project,
      checkoutDir: '/nonexistent',
      log: () => {},
      signal: new AbortController().signal,
      sandbox: { ensureUp: async () => {} },
    } as unknown as ActionRuntime
    failing.add('bash -lc ddev npm run build')
    await expect(ddevStartAction.run({ type: 'ddev-start' }, rt)).rejects.toThrow()
    failing.clear()
    await ddevStartAction.run({ type: 'ddev-start' }, rt)
    expect(getSessionRow(session.id)).toMatchObject({ envState: 'up', tier: 'preview', wakeOnVisit: true })
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
    expect(calls).toEqual(['ddev start', 'bash -lc pnpm install', 'bash -lc pnpm run build', 'workspace removed'])
    expect(getSessionRow(session.id)).toMatchObject({ envState: 'up', tier: 'preview' })
  })

  it('refuses a session without a checkout', async () => {
    const session = makeSession(makeProject())
    await expect(reviveEnv(session.id)).rejects.toThrow('no checkout')
    expect(calls).toEqual([])
  })
})

describe('reviveWithoutPreview', () => {
  it('lends a stopped code session a workspace and leaves it stopped', async () => {
    const session = makeSession(makeProject(), { envState: 'stopped' })
    expect(await reviveWithoutPreview(session.id)).toEqual({ inWorkspace: true })
    expect(calls).toEqual(['workspace up'])
    expect(getSessionRow(session.id).envState).toBe('stopped')
  })

  it('keeps the lent workspace when the session was revived meanwhile', async () => {
    const session = makeSession(makeProject(), { envState: 'stopped' })
    await reviveWithoutPreview(session.id)
    await reviveEnv(session.id)
    calls.length = 0
    await releaseWorkspace(session.id)
    expect(calls).toEqual([])
  })

  it('removes the lent workspace of a session still stopped', async () => {
    const session = makeSession(makeProject(), { envState: 'stopped' })
    await reviveWithoutPreview(session.id)
    await releaseWorkspace(session.id)
    expect(calls.at(-1)).toBe('workspace removed')
  })
})

describe('cancelling an environment operation', () => {
  it('leaves a stopped preview stopped when its reboot is cancelled', async () => {
    const session = makeSession(makeProject(), { envState: 'stopped', tier: 'preview' })
    startEnvStack.mockImplementationOnce(async () => {
      calls.push('ddev start')
      expect(cancelOperation(session.id)).toBe(true)
      expect(envTransition(session.id)).toBe('stopping')
    })
    await expect(rebootEnv(session.id)).rejects.toBeInstanceOf(OperationCancelled)
    expect(calls.slice(-2)).toEqual(['ddev start', 'ddev stop'])
    expect(getSessionRow(session.id)).toMatchObject({ envState: 'stopped', envOperation: null })
  })

  it('cancels nothing that cannot be rolled back', async () => {
    const session = makeSession(makeProject(), { envState: 'up', tier: 'preview' })
    stopEnvStack.mockImplementationOnce(async () => {
      expect(cancelOperation(session.id)).toBe(false)
    })
    await stopEnv(session.id)
    expect(getSessionRow(session.id).envState).toBe('stopped')
  })
})

describe('deleteEnv', () => {
  it('tears the session down only after the boot under way wound down', async () => {
    const session = freshSession(makeProject())
    mkdirSync(sessionArchiveDir(session.id), { recursive: true })
    const cancel = new AbortController()
    let deleted: Promise<void> | undefined
    onStream = (line) => {
      if (line !== 'bash -lc pnpm install') return
      cancel.abort()
      db.delete(schema.sessions).where(eq(schema.sessions.id, session.id)).run()
      deleted = deleteEnv(session.id)
    }
    await expect(inMailbox(session.id, 'booting', () => bootEnv(session.id, { dbFile: null, projectCommands: 'pnpm install', signal: cancel.signal }))).rejects.toThrow()
    await deleted
    // The boot's own cleanup, then the teardown.
    expect(calls.slice(-3)).toEqual(['ddev stop', 'workspace removed', 'workspace removed'])
    expect(existsSync(sessionArchiveDir(session.id))).toBe(false)
  })

  it('refuses what was queued before the delete and anything after it', async () => {
    const session = freshSession(makeProject())
    let release = () => {}
    const busy = inMailbox(session.id, 'rebooting', () => new Promise<void>((resolve) => {
      release = resolve
    }))
    await vi.waitFor(() => expect(envTransition(session.id)).toBe('rebooting'))
    const queued = reviveEnv(session.id)
    db.delete(schema.sessions).where(eq(schema.sessions.id, session.id)).run()
    const deleted = deleteEnv(session.id)
    release()
    await busy
    await expect(queued).rejects.toBeInstanceOf(SessionGone)
    await deleted
    await expect(reviveEnv(session.id)).rejects.toBeInstanceOf(SessionGone)
    expect(calls).not.toContain('workspace up')
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

  it('puts a cancelled restore back to archived and keeps the archive', async () => {
    const { session, dir } = stoppedCheckout('')
    db.update(schema.sessions).set({ tier: 'preview' }).where(eq(schema.sessions.id, session.id)).run()
    await archiveEnv(session.id)
    startEnvStack.mockImplementationOnce(async () => {
      cancelOperation(session.id)
    })
    await expect(rehydrateEnv(session.id)).rejects.toBeInstanceOf(OperationCancelled)
    expect(getSessionRow(session.id)).toMatchObject({ envState: 'archived', envOperation: null })
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(join(sessionArchiveDir(session.id), 'checkout.tar.gz'))).toBe(true)
    await rehydrateEnv(session.id)
    expect(getSessionRow(session.id).envState).toBe('up')
  })

  it('keeps a vendor directory the repo commits', async () => {
    const { session, dir } = stoppedCheckout('/vendor/*\n!/vendor/lib.php\n')
    await archiveEnv(session.id)
    await rehydrateEnv(session.id)
    expect(readFileSync(join(dir, 'vendor', 'lib.php'), 'utf8')).toBe('lib\n')
  })

  it('restores an archive in the earlier .git-plus-patch format inside the workspace', async () => {
    const { session, dir } = stoppedCheckout('')
    const head = git(dir, 'rev-parse', 'HEAD')
    writeFileSync(join(dir, 'tracked.txt'), 'v2 uncommitted\n')
    writeFileSync(join(dir, 'untracked.txt'), 'new\n')
    git(dir, 'add', '-A')
    const archiveDir = sessionArchiveDir(session.id)
    mkdirSync(archiveDir, { recursive: true })
    execFileSync('tar', ['-czf', join(archiveDir, 'git.tar.gz'), '-C', dir, '.git'])
    writeFileSync(join(archiveDir, 'checkout.patch'), execFileSync('git', ['-C', dir, 'diff', '--cached', '--binary'], { encoding: 'utf8' }))
    rmSync(dir, { recursive: true })
    db.update(schema.sessions).set({ envState: 'archived' }).where(eq(schema.sessions.id, session.id)).run()

    await rehydrateEnv(session.id)
    // A retry must not apply the patch twice.
    db.update(schema.sessions).set({ envState: 'archived' }).where(eq(schema.sessions.id, session.id)).run()
    await rehydrateEnv(session.id)
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head)
    expect(readFileSync(join(dir, 'tracked.txt'), 'utf8')).toBe('v2 uncommitted\n')
    expect(readFileSync(join(dir, 'untracked.txt'), 'utf8')).toBe('new\n')
    expect(calls).toContain(`checkout ${session.id}: git reset --hard`)
    expect(getSessionRow(session.id).envState).toBe('up')
  })

  it('keeps the checkout and the session stopped when the snapshot fails', async () => {
    const { session, dir } = stoppedCheckout('')
    mkdirSync(join(sessionArchiveDir(session.id), '..'), { recursive: true })
    writeFileSync(sessionArchiveDir(session.id), 'not a directory')
    await expect(archiveEnv(session.id)).rejects.toThrow()
    expect(getSessionRow(session.id).envState).toBe('stopped')
    expect(readFileSync(join(dir, 'tracked.txt'), 'utf8')).toBe('v1\n')
    rmSync(sessionArchiveDir(session.id))
  })

  it('starts fresh and says so when the archive is gone and the branch never reached origin', async () => {
    origin.url = remoteWithMain()
    const session = makeSession(makeProject(), { envState: 'archived', branch: 'never-pushed' })
    const log: string[] = []
    await rehydrateEnv(session.id, text => log.push(text))
    const dir = sessionCheckoutDir(session.id)
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('never-pushed')
    expect(log.join('')).toContain('archived state of this session is gone')
    expect(getSessionRow(session.id).envState).toBe('up')
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

  it('keeps a preview stopped by hand from waking on a visit until it is up again', async () => {
    const session = makeSession(makeProject())
    db.update(schema.sessions).set({ envState: 'up', tier: 'preview' }).where(eq(schema.sessions.id, session.id)).run()
    await stopEnv(session.id)
    expect(getSessionRow(session.id).wakeOnVisit).toBe(true)

    await reviveEnv(session.id)
    await stopEnv(session.id, { byHand: true })
    expect(getSessionRow(session.id).wakeOnVisit).toBe(false)

    await reviveEnv(session.id)
    expect(getSessionRow(session.id)).toMatchObject({ envState: 'up', wakeOnVisit: true })
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
