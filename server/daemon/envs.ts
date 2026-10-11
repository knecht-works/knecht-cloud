import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import type { Project } from '../db/schema'
import type { EnvTransition } from '../../shared/utils/run'
import { getSettings } from '../utils/settings'
import { getInstallationToken } from '../utils/github-app'
import { projectDumpDir, sessionArchiveDir, sessionCheckoutDir } from '../utils/storage'
import { configureSessionEnv, readDdevConfig } from './ddev'
import { restartDevServer, waitForDevServer } from './dev-server'
import { prepareSessionCheckout } from './git'
import { envStackRunning, execInSandbox, forgetPreview, removeEnvStack, startEnvStack, stopEnvStack, streamInSandbox } from './sandbox'
import { getProject } from '../stores/projects'
import { getSessionRow, listSessionsInEnvState, updateSession, touchSessionPreview } from '../stores/sessions'
import { listRunSessionIds } from '../stores/runs'
import { lastSuccessfulSessionStep, listRunIdsWithRunningSteps } from '../stores/run-steps'
import { listRunningFollowupSessionIds } from '../stores/followups'

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

export async function ensureEnvUp(sessionId: number, log?: (text: string) => void): Promise<void> {
  if (!await envStackRunning(sessionId)) await startEnvStack(sessionId, log)
  markUp(sessionId)
}

export interface BootPlan {
  dbFile: string | null
  projectCommands: string
  stepCommands?: string
  log?: (text: string) => void
  signal?: AbortSignal
}

// A half-booted stack would otherwise idle until the reaper reclaims it.
export async function bootEnv(sessionId: number, plan: BootPlan): Promise<void> {
  const log = plan.log ?? (() => {})
  const exec = async (command: string[]) => (await streamInSandbox(sessionId, command, log, undefined, plan.signal)).code
  const priorState = getSessionRow(sessionId)?.envState ?? 'down'
  try {
    await startEnvStack(sessionId, log)
    markUp(sessionId)
    if (plan.dbFile) {
      log(`\n▶ import-db (${basename(plan.dbFile)})\n`)
      const code = await exec(['ddev', 'import-db', `--file=${plan.dbFile}`])
      if (code !== 0) throw new Error(`ddev import-db exited with code ${code}`)
    }
    if (plan.projectCommands.trim()) log(`\nBoot commands (project settings):\n`)
    await runSetupCommands(plan.projectCommands, c => exec(['bash', '-lc', c]), log)
    if (plan.stepCommands?.trim()) log(`\nAdditional setup commands (this workflow's boot step):\n`)
    await runSetupCommands(plan.stepCommands, c => exec(['bash', '-lc', c]), log)
    const port = getSessionRow(sessionId)?.previewPort
    if (port != null) {
      log(`\n▶ Starting the dev server on port ${port}\n`)
      await restartDevServer(exec)
      await waitForDevServer(sessionId, port)
    }
  }
  catch (e) {
    await stopEnvStack(sessionId).catch(() => {})
    updateSession(sessionId, { envState: priorState })
    throw e
  }
}

async function runSetupCommands(
  commands: string | undefined,
  exec: (command: string) => Promise<number>,
  log: (text: string) => void,
): Promise<void> {
  const lines = (commands ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  for (const command of lines) {
    log(`\n▶ ${command}\n`)
    const code = await exec(command)
    if (code !== 0) throw new Error(`'${command}' exited with code ${code}`)
  }
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
  updateSession(sessionId, { previewPort: port })
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
  pinDevServerPort(sessionId, await configureEnv(dir, project, sessionId, session.urlMode ?? 'rewrite'))

  const bootStep = lastBootStep(sessionId)
  await bootEnv(sessionId, {
    dbFile: archivedDbFile(sessionId, project),
    projectCommands: bootStep ? project.bootCommands : '',
    stepCommands: bootStep?.commands,
  })
}

export async function reviveEnv(sessionId: number): Promise<void> {
  const state = getSessionRow(sessionId)?.envState
  if (state === 'archived') await rehydrateEnv(sessionId)
  else if (state === 'stopped') await rebootEnv(sessionId)
  else await ensureEnvUp(sessionId)
}

function lastBootStep(sessionId: number): { commands?: string } | null {
  const row = lastSuccessfulSessionStep(sessionId, 'ddev-start')
  return row ? (row.params ?? {}) as { commands?: string } : null
}

// No restart policy on containers (per-container policies leave a stack with
// add-on services half-up), so every 'up' env gets an unconditional `ddev start`.
export async function reconcileEnvStates(): Promise<void> {
  const up = listSessionsInEnvState('up')
  for (const { id } of up) {
    try {
      await startEnvStack(id)
      markUp(id)
    }
    catch (err) {
      forgetPreview(id)
      updateSession(id, { envState: 'stopped' })
      console.error(`[envs] boot restore of session ${id} failed, marked stopped:`, err)
    }
  }
}

function markUp(sessionId: number): void {
  updateSession(sessionId, { envState: 'up', previewLastSeen: new Date() })
}

// The reaper tick must not pile a second stop onto a session mid-export.
export async function stopEnv(sessionId: number): Promise<void> {
  if (transitions.get(sessionId) === 'stopping') return
  await inTransition(sessionId, 'stopping', async () => {
    await exportSessionDb(sessionId)
    // `ddev stop` on an unregistered project fails and would wedge the env in 'up'.
    if (await envStackRunning(sessionId)) await stopEnvStack(sessionId)
    updateSession(sessionId, { envState: 'stopped' })
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
  const idle = listSessionsInEnvState('up', { seenBefore: cutoff })
  if (!idle.length) return
  const runningRuns = listRunIdsWithRunningSteps()
  const busy = new Set([
    ...listRunSessionIds(runningRuns),
    ...listRunningFollowupSessionIds(),
  ])
  for (const { id } of idle) {
    try {
      if (busy.has(id)) {
        touchSessionPreview(id)
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
  const stale = listSessionsInEnvState('stopped', { seenBefore: cutoff })
  for (const session of stale) await archiveEnv(session.id)
}

export async function archiveEnv(sessionId: number): Promise<void> {
  await inTransition(sessionId, 'archiving', async () => {
    await snapshotCheckout(sessionId)
    await teardownSession(sessionId)
    updateSession(sessionId, { envState: 'archived' })
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
    updateSession(sessionId, { commitSha: sha.trim() })
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
  const expired = listSessionsInEnvState('archived', { seenBefore: cutoff })
  for (const { id } of expired) {
    rmSync(sessionArchiveDir(id), { recursive: true, force: true })
    // Or the boot step treats the session as already booted.
    updateSession(id, { envState: 'down', previewReady: false })
  }
}

function archivedDbFile(sessionId: number, project: Project): string | null {
  const archived = join(sessionArchiveDir(sessionId), 'db.sql.gz')
  const fallback = project.dbDumpPath && join(projectDumpDir(project.id), basename(project.dbDumpPath))
  return existsSync(archived) ? archived : fallback && existsSync(fallback) ? fallback : null
}

export async function teardownSession(sessionId: number): Promise<void> {
  await removeEnvStack(sessionId)
  rmSync(sessionCheckoutDir(sessionId), { recursive: true, force: true })
}
