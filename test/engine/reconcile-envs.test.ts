import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { EnvTransition } from '#shared/utils/run'
import { getSessionRow, makeProject, makeRun } from '../helpers/db'

const startEnvStack = vi.fn(async (_sessionId: number) => {})
const stopEnvStack = vi.fn(async (_sessionId: number) => {})
const forgetPreview = vi.fn()
vi.mock('#server/daemon/sandbox', () => ({
  envStackRunning: async () => true,
  execInSandbox: async () => ({ stdout: '' }),
  forgetPreview: (sessionId: number) => forgetPreview(sessionId),
  removeEnvStack: async () => {},
  startEnvStack: (sessionId: number) => startEnvStack(sessionId),
  stopEnvStack: (sessionId: number) => stopEnvStack(sessionId),
}))
const removeWorkspace = vi.fn(async (_sessionId: number) => {})
vi.mock('#server/daemon/workspace', () => ({ ensureWorkspaceUp: async () => {}, removeWorkspace: (sessionId: number) => removeWorkspace(sessionId) }))
vi.mock('#server/daemon/db-base', () => ({ archiveDbVolume: async () => {} }))

const { db, schema } = await import('#server/db')
const { reconcileEnvStates, reviveEnv } = await import('#server/daemon/envs')
const { sessionArchiveDir, sessionCheckoutDir } = await import('#server/utils/storage')

function makeSessionInState(envState: 'up' | 'stopped' | 'archived', tier: 'code' | 'preview' = 'preview', envOperation: EnvTransition | null = null) {
  const project = makeProject()
  const run = makeRun(project, [])
  db.update(schema.sessions)
    .set({ envState, tier, envOperation, previewLastSeen: new Date() })
    .where(eq(schema.sessions.id, run.sessionId))
    .run()
  return run
}

describe('reconcileEnvStates', () => {
  it('starts every up env and keeps it up', async () => {
    const a = makeSessionInState('up')
    const b = makeSessionInState('up')
    await reconcileEnvStates()
    expect(startEnvStack).toHaveBeenCalledWith(a.sessionId)
    expect(startEnvStack).toHaveBeenCalledWith(b.sessionId)
    expect(getSessionRow(a.sessionId).envState).toBe('up')
    expect(getSessionRow(b.sessionId).envState).toBe('up')
  })

  it('downgrades an env whose start fails to stopped and forgets its preview IP', async () => {
    const broken = makeSessionInState('up')
    const fine = makeSessionInState('up')
    // The broken session is pinned to the front so the one-shot failing start hits it.
    db.update(schema.sessions)
      .set({ previewLastSeen: new Date(Date.now() + 60_000) })
      .where(eq(schema.sessions.id, broken.sessionId))
      .run()
    startEnvStack.mockImplementationOnce(async () => {
      throw new Error('volume gone')
    })
    await reconcileEnvStates()
    expect(getSessionRow(broken.sessionId).envState).toBe('stopped')
    expect(getSessionRow(fine.sessionId).envState).toBe('up')
    expect(forgetPreview).toHaveBeenCalledWith(broken.sessionId)
  })

  it('stops a ddev stack an up code session should not have, and starts nothing', async () => {
    const code = makeSessionInState('up', 'code')
    startEnvStack.mockClear()
    await reconcileEnvStates()
    expect(stopEnvStack).toHaveBeenCalledWith(code.sessionId)
    expect(startEnvStack).not.toHaveBeenCalledWith(code.sessionId)
    expect(getSessionRow(code.sessionId).envState).toBe('up')
  })

  it('leaves stopped and archived envs on the retention ladder', async () => {
    const stopped = makeSessionInState('stopped')
    const archived = makeSessionInState('archived')
    startEnvStack.mockClear()
    await reconcileEnvStates()
    expect(startEnvStack).not.toHaveBeenCalledWith(stopped.sessionId)
    expect(startEnvStack).not.toHaveBeenCalledWith(archived.sessionId)
    expect(getSessionRow(stopped.sessionId).envState).toBe('stopped')
    expect(getSessionRow(archived.sessionId).envState).toBe('archived')
  })

  it.each(['booting', 'rebooting', 'stopping'] as const)('stops a session the daemon left %s', async (operation) => {
    const run = makeSessionInState('up', 'code', operation)
    stopEnvStack.mockClear()
    removeWorkspace.mockClear()
    await reconcileEnvStates()
    expect(stopEnvStack).toHaveBeenCalledWith(run.sessionId)
    expect(removeWorkspace).toHaveBeenCalledWith(run.sessionId)
    expect(getSessionRow(run.sessionId)).toMatchObject({ envState: 'stopped', envOperation: null })
  })

  it('leaves a session archived whose restore the daemon cut short', async () => {
    const run = makeSessionInState('archived', 'preview', 'restoring')
    await reconcileEnvStates()
    expect(getSessionRow(run.sessionId)).toMatchObject({ envState: 'archived', envOperation: null })
  })

  it('finishes an archive the daemon cut short', async () => {
    const run = makeSessionInState('stopped', 'preview', 'archiving')
    await reconcileEnvStates()
    expect(getSessionRow(run.sessionId)).toMatchObject({ envState: 'archived', envOperation: null })
  })

  function archiveCutShort(snapshotDone: boolean) {
    const run = makeSessionInState('stopped', 'preview', 'archiving')
    mkdirSync(join(sessionCheckoutDir(run.sessionId), '.git'), { recursive: true })
    const archive = join(sessionArchiveDir(run.sessionId), 'checkout.tar.gz')
    mkdirSync(sessionArchiveDir(run.sessionId), { recursive: true })
    writeFileSync(archive, 'earlier archive')
    if (snapshotDone) writeFileSync(join(sessionArchiveDir(run.sessionId), 'snapshot.complete'), '')
    return { run, archive }
  }

  it('keeps the snapshot of an archive the daemon cut short in its teardown', async () => {
    const { run, archive } = archiveCutShort(true)
    await reconcileEnvStates()
    expect(readFileSync(archive, 'utf8')).toBe('earlier archive')
    expect(getSessionRow(run.sessionId).envState).toBe('archived')
  })

  it('snapshots again an archive the daemon cut short before its snapshot was complete', async () => {
    const { run, archive } = archiveCutShort(false)
    await reconcileEnvStates()
    expect(readFileSync(archive, 'utf8')).not.toBe('earlier archive')
    expect(getSessionRow(run.sessionId).envState).toBe('archived')
  })

  it('finishes an expiry the daemon cut short', async () => {
    const run = makeSessionInState('archived', 'preview', 'expiring')
    mkdirSync(sessionArchiveDir(run.sessionId), { recursive: true })
    writeFileSync(join(sessionArchiveDir(run.sessionId), 'checkout.tar.gz'), '')
    await reconcileEnvStates()
    expect(existsSync(sessionArchiveDir(run.sessionId))).toBe(false)
    expect(getSessionRow(run.sessionId)).toMatchObject({ envState: 'down', tier: 'code', envOperation: null })
  })

  it('holds back a revive that arrives while the session is reconciled', async () => {
    const run = makeSessionInState('up', 'code', 'booting')
    // Ahead of the reconcile, the revive would find it up and the reconcile would stop it after.
    await Promise.all([reconcileEnvStates(), reviveEnv(run.sessionId)])
    expect(getSessionRow(run.sessionId).envState).toBe('up')
  })
})
