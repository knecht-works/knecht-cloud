import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import type { EnvTransition } from '../../shared/utils/run'
import { getSettings } from '../utils/settings'
import { getProject, getSessionRow } from '../utils/entities'
import { getInstallationToken } from '../utils/github-app'
import { projectDumpDir, sessionArchiveDir, sessionCheckoutDir } from '../utils/storage'
import { joinBootCommands, runSetupCommands } from '../workflows/actions/ddev-start'
import { configureSessionEnv, readDdevConfig } from './ddev'
import { restartDevServer, waitForDevServer } from './dev-server'
import { prepareSessionCheckout } from './git'
import { envStackRunning, execInSandbox, forgetPreview, removeEnvStack, startEnvStack, stopEnvStack } from './sandbox'

// In memory on purpose: a crash mid-transition must not wedge a DB state no reaper reclaims.
const transitions = new Map<number, EnvTransition>()

export function envTransition(sessionId: number): EnvTransition | null {
  return transitions.get(sessionId) ?? null
}

async function inTransition(sessionId: number, kind: EnvTransition, fn: () => Promise<void>): Promise<void> {
  transitions.set(sessionId, kind)
  try {
    await fn()
  }
  finally {
    transitions.delete(sessionId)
  }
}

export async function ensureEnvUp(sessionId: number): Promise<void> {
  if (!await envStackRunning(sessionId)) await startEnvStack(sessionId)
  markUp(sessionId)
}

export async function rebootEnv(sessionId: number): Promise<void> {
  await inTransition(sessionId, 'rebooting', async () => {
    // Regenerate first, or the reboot runs on the original boot's compose override.
    const session = getSessionRow(sessionId)
    const project = session && getProject(session.projectId)
    const dir = sessionCheckoutDir(sessionId)
    if (session && project && existsSync(dir)) {
      pinDevServerPort(sessionId, await configureEnv(dir, project, sessionId, session.urlMode ?? 'rewrite'))
    }
    await startEnvStack(sessionId)
    markUp(sessionId)
  })
}

async function configureEnv(dir: string, project: Project, sessionId: number, urlMode: 'env' | 'rewrite'): Promise<number | null> {
  const { warnings, devServerPort } = await configureSessionEnv(dir, project, sessionId, urlMode)
  for (const warning of warnings) console.warn(`[envs] session ${sessionId}: ${warning}`)
  return devServerPort
}

function pinDevServerPort(sessionId: number, port: number | null): void {
  db.update(schema.sessions).set({ previewPort: port }).where(eq(schema.sessions.id, sessionId)).run()
}

export async function rehydrateEnv(sessionId: number): Promise<void> {
  await inTransition(sessionId, 'restoring', () => restoreFromArchive(sessionId))
}

async function restoreFromArchive(sessionId: number): Promise<void> {
  const session = getSessionRow(sessionId)
  const project = session && getProject(session.projectId)
  if (!session || !project) throw new Error('Session or project not found')

  const dir = sessionCheckoutDir(sessionId)
  const gitArchive = join(sessionArchiveDir(sessionId), 'git.tar.gz')
  if (existsSync(gitArchive)) {
    // Unpack and reset on every attempt: a crash in between must not look like a finished restore.
    mkdirSync(dir, { recursive: true })
    await execa('tar', ['-xzf', gitArchive, '-C', dir])
    await execa('git', ['-C', dir, 'reset', '--hard'])
  }
  else if (existsSync(join(dir, '.git'))) {
    // Keep the prior fallback clone.
  }
  else {
    const token = await getInstallationToken(project.owner, project.name)
    await prepareSessionCheckout(project, sessionId, token, () => {}, session.branch ?? project.defaultBranch)
  }

  // Only onto a clean checkout, or a retry applies it twice.
  const patch = join(sessionArchiveDir(sessionId), 'checkout.patch')
  if (existsSync(patch)) {
    const { stdout: status } = await execa('git', ['-C', dir, 'status', '--porcelain'])
    if (!status.trim()) await execa('git', ['-C', dir, 'apply', patch])
  }

  // Only when the checkout has none yet: a retry must keep the live state.
  const stateArchive = join(sessionArchiveDir(sessionId), 'knecht-state.tar.gz')
  if (existsSync(stateArchive) && !existsSync(join(dir, '.knecht'))) {
    await execa('tar', ['-xzf', stateArchive, '-C', dir])
  }
  const devServerPort = await configureEnv(dir, project, sessionId, session.urlMode ?? 'rewrite')
  pinDevServerPort(sessionId, devServerPort)

  await startEnvStack(sessionId)
  try {
    await importArchivedDb(sessionId, project)
    await rerunBootSetup(sessionId, project)
    if (devServerPort !== null) {
      await restartDevServer(async command => (await execInSandbox(sessionId, command, { reject: false })).exitCode ?? 1)
      await waitForDevServer(sessionId, devServerPort)
    }
  }
  catch (e) {
    // A half-restored stack must not stay 'archived': no reaper reclaims that state.
    await stopEnvStack(sessionId)
    throw e
  }
  markUp(sessionId)
}

export async function reviveEnv(sessionId: number): Promise<void> {
  const state = getSessionRow(sessionId)?.envState
  if (state === 'archived') await rehydrateEnv(sessionId)
  else if (state === 'stopped') await rebootEnv(sessionId)
  else await ensureEnvUp(sessionId)
}

async function rerunBootSetup(sessionId: number, project: Project): Promise<void> {
  const row = db
    .select({ params: schema.runSteps.params })
    .from(schema.runSteps)
    .innerJoin(schema.runs, eq(schema.runSteps.runId, schema.runs.id))
    .where(and(
      eq(schema.runs.sessionId, sessionId),
      eq(schema.runSteps.type, 'ddev-start'),
      eq(schema.runSteps.status, 'success'),
    ))
    .orderBy(desc(schema.runSteps.id))
    .get()
  if (!row) return
  const { commands } = (row.params ?? {}) as { commands?: string }
  await runSetupCommands(joinBootCommands(project.bootCommands, commands), async (command) => {
    const { exitCode } = await execInSandbox(sessionId, ['bash', '-lc', command], { reject: false })
    return exitCode ?? 1
  })
}

// No restart policy on containers (per-container policies leave a stack with
// add-on services half-up), so every 'up' env gets an unconditional `ddev start`.
export async function reconcileEnvStates(): Promise<void> {
  const up = db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.envState, 'up'))
    .orderBy(desc(schema.sessions.previewLastSeen))
    .all()
  for (const { id } of up) {
    try {
      await startEnvStack(id)
      markUp(id)
    }
    catch (err) {
      forgetPreview(id)
      db.update(schema.sessions).set({ envState: 'stopped' }).where(eq(schema.sessions.id, id)).run()
      console.error(`[envs] boot restore of session ${id} failed, marked stopped:`, err)
    }
  }
}

function markUp(sessionId: number): void {
  db.update(schema.sessions)
    .set({ envState: 'up', previewLastSeen: new Date() })
    .where(eq(schema.sessions.id, sessionId))
    .run()
}

// The reaper tick must not pile a second stop onto a session mid-export.
export async function stopEnv(sessionId: number): Promise<void> {
  if (transitions.get(sessionId) === 'stopping') return
  await inTransition(sessionId, 'stopping', async () => {
    await exportSessionDb(sessionId)
    // `ddev stop` on an unregistered project fails and would wedge the env in 'up'.
    if (await envStackRunning(sessionId)) await stopEnvStack(sessionId)
    db.update(schema.sessions).set({ envState: 'stopped' }).where(eq(schema.sessions.id, sessionId)).run()
  })
}

async function exportSessionDb(sessionId: number): Promise<void> {
  if (readDdevConfig(sessionCheckoutDir(sessionId))?.hasDb === false) return
  try {
    mkdirSync(sessionArchiveDir(sessionId), { recursive: true })
    await execInSandbox(sessionId, ['ddev', 'export-db', `--file=${join(sessionArchiveDir(sessionId), 'db.sql.gz')}`])
  }
  catch {
    // Restore falls back to the project dump.
  }
}

// Stopping under a running step would SIGKILL the agent inside (exit 137).
export async function reapIdleEnvs(): Promise<void> {
  const { idleStopMinutes } = getSettings()
  const cutoff = new Date(Date.now() - idleStopMinutes * 60_000)
  const idle = db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.envState, 'up'), lt(schema.sessions.previewLastSeen, cutoff)))
    .all()
  if (!idle.length) return
  const runningRuns = db
    .select({ runId: schema.runSteps.runId })
    .from(schema.runSteps)
    .where(eq(schema.runSteps.status, 'running'))
    .all()
    .map(r => r.runId)
  const busy = new Set(runningRuns.length
    ? db
        .select({ sessionId: schema.runs.sessionId })
        .from(schema.runs)
        .where(inArray(schema.runs.id, runningRuns))
        .all()
        .map(r => r.sessionId)
    : [])
  for (const { id } of idle) {
    try {
      if (busy.has(id)) {
        db.update(schema.sessions).set({ previewLastSeen: new Date() }).where(eq(schema.sessions.id, id)).run()
        continue
      }
      await stopEnv(id)
    }
    catch {
      // Retried on the next tick.
    }
  }
}

export async function archiveStaleEnvs(): Promise<void> {
  const { previewRetentionDays } = getSettings()
  if (previewRetentionDays <= 0) return
  const cutoff = new Date(Date.now() - previewRetentionDays * 86_400_000)
  const stale = db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.envState, 'stopped'), lt(schema.sessions.previewLastSeen, cutoff)))
    .all()
  for (const session of stale) await archiveEnv(session.id)
}

export async function archiveEnv(sessionId: number): Promise<void> {
  await inTransition(sessionId, 'archiving', async () => {
    await snapshotCheckout(sessionId)
    await teardownSession(sessionId)
    db.update(schema.sessions).set({ envState: 'archived' }).where(eq(schema.sessions.id, sessionId)).run()
  })
}

// The .git tarball keeps unpushed commits; a branch-tip clone would lose them.
// The knecht ddev config sits in info/exclude, so no secrets enter the patch.
async function snapshotCheckout(sessionId: number): Promise<void> {
  const dir = sessionCheckoutDir(sessionId)
  const gitDir = join(dir, '.git')
  if (!existsSync(gitDir)) return
  try {
    const { stdout: sha } = await execa('git', ['-C', dir, 'rev-parse', 'HEAD'])
    db.update(schema.sessions).set({ commitSha: sha.trim() }).where(eq(schema.sessions.id, sessionId)).run()
    await execa('git', ['-C', dir, 'add', '-A'])
    mkdirSync(sessionArchiveDir(sessionId), { recursive: true })
    // .git first: a diff that blows maxBuffer below must still leave a restorable object store.
    await execa('tar', ['-czf', join(sessionArchiveDir(sessionId), 'git.tar.gz'), '-C', dir, '.git'])
    if (existsSync(join(dir, '.knecht'))) {
      await execa('tar', ['-czf', join(sessionArchiveDir(sessionId), 'knecht-state.tar.gz'), '-C', dir, '.knecht'])
    }
    // execa strips the final newline by default and `git apply` then rejects the patch.
    const { stdout: patch } = await execa('git', ['-C', dir, 'diff', '--cached', '--binary'], { maxBuffer: 256 * 1024 * 1024, stripFinalNewline: false })
    if (patch.trim()) {
      writeFileSync(join(sessionArchiveDir(sessionId), 'checkout.patch'), patch)
    }
  }
  catch {
    // Restore falls back to the branch tip.
  }
}

export async function reapExpiredArchives(): Promise<void> {
  const { archiveRetentionDays } = getSettings()
  if (archiveRetentionDays <= 0) return
  const cutoff = new Date(Date.now() - archiveRetentionDays * 86_400_000)
  const expired = db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.envState, 'archived'), lt(schema.sessions.previewLastSeen, cutoff)))
    .all()
  for (const { id } of expired) {
    rmSync(sessionArchiveDir(id), { recursive: true, force: true })
    // Or the boot step treats the session as already booted.
    db.update(schema.sessions).set({ envState: 'down', previewReady: false }).where(eq(schema.sessions.id, id)).run()
  }
}

async function importArchivedDb(sessionId: number, project: Project): Promise<void> {
  const archived = join(sessionArchiveDir(sessionId), 'db.sql.gz')
  const fallback = project.dbDumpPath && join(projectDumpDir(project.id), basename(project.dbDumpPath))
  const file = existsSync(archived) ? archived : fallback && existsSync(fallback) ? fallback : null
  if (!file) return
  await execInSandbox(sessionId, ['ddev', 'import-db', `--file=${file}`])
}

export async function teardownSession(sessionId: number): Promise<void> {
  await removeEnvStack(sessionId)
  rmSync(sessionCheckoutDir(sessionId), { recursive: true, force: true })
}
