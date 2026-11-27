import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import type { NewSession, Project } from '#server/db/schema'
import type { EnvState, EnvTransition, SessionTier } from '#shared/utils/run'
import { getSettings } from '#server/utils/settings'
import { gitProvider } from '#server/git'
import { projectDumpDir, sessionArchiveDir, sessionCheckoutDir } from '#server/utils/storage'
import { configureSessionEnv } from '#server/daemon/ddev'
import { archiveDbVolume, archivedDbVolume, cloneDbBase, readyDbBase, restoreDbVolume, type ReadyDbBase } from '#server/daemon/db-base'
import { devServerOutput, noteDevServerUse, restartDevServer, waitForDevServer } from '#server/daemon/dev-server'
import { prepareSessionCheckout } from '#server/daemon/git'
import { ensureWorkspaceUp, removeWorkspace, runOnCheckout } from '#server/daemon/workspace'
import { envStackRunning, forgetPreview, removeEnvStack, runTag, startEnvStack, stopEnvStack, streamInSandbox } from '#server/daemon/sandbox'
import { warmPreviewCertificates } from '#server/utils/preview-certs'
import { getProject } from '#server/stores/projects'
import { getSessionRow, listSessionsInEnvState, listSessionsWithEnvOperation, moveSession, sessionBase, updateSession, touchSessionPreview } from '#server/stores/sessions'
import { listRunSessionIds, sessionHasActiveRun } from '#server/stores/runs'
import { lastSuccessfulSessionStep, listRunIdsWithRunningSteps } from '#server/stores/run-steps'
import { listRunningFollowupSessionIds, sessionHasActiveFollowup } from '#server/stores/followups'
import { abortOperation, asOperation, envOperation, inMailbox, mailboxDrained, operationSignal, relabelOperation } from '#server/daemon/session-env'

export { envOperation as envTransition } from '#server/daemon/session-env'

type EnvEvent = 'checkOut' | 'boot' | 'failBoot' | 'start' | 'stop' | 'archive' | 'restore' | 'expire'

const EVENTS: Record<EnvEvent, { from: EnvState[], to: Partial<NewSession> & { envState: EnvState } }> = {
  checkOut: { from: ['down'], to: { envState: 'up' } },
  // From stopped too: a failed boot leaves the session stopped, and a step retry boots it again.
  boot: { from: ['up', 'stopped', 'archived'], to: { envState: 'up', tier: 'preview' } },
  failBoot: { from: ['up'], to: { envState: 'stopped', wakeOnVisit: false } },
  start: { from: ['stopped'], to: { envState: 'up' } },
  stop: { from: ['up'], to: { envState: 'stopped' } },
  archive: { from: ['stopped'], to: { envState: 'archived' } },
  restore: { from: ['archived'], to: { envState: 'up' } },
  // Or the boot step treats the session as already booted.
  expire: { from: ['archived'], to: { envState: 'down', tier: 'code' } },
}

// Read inside the transition: the listing that picked the session may be stale by now.
function stillIn(sessionId: number, state: EnvState): boolean {
  return getSessionRow(sessionId)?.envState === state
}

function tryEnvEvent(sessionId: number, event: EnvEvent, patch: Partial<NewSession> = {}): boolean {
  const { from, to } = EVENTS[event]
  const seen = to.envState === 'up' ? { previewLastSeen: new Date(), wakeOnVisit: true } : {}
  return moveSession(sessionId, from, { ...seen, ...to, ...patch })
}

function envEvent(sessionId: number, event: EnvEvent, patch: Partial<NewSession> = {}): void {
  if (!tryEnvEvent(sessionId, event, patch)) {
    throw new Error(`Session ${sessionId} is ${getSessionRow(sessionId)?.envState ?? 'gone'}, so it cannot ${event}`)
  }
}

// The checkout exists from here on, so the session takes part in the idle lifecycle.
export async function markCheckedOut(sessionId: number): Promise<void> {
  await inMailbox(sessionId, null, async () => tryEnvEvent(sessionId, 'checkOut'))
}

export interface BootPlan {
  dbFile: string | null
  dbBase?: ReadyDbBase | null
  dbArchive?: string | null
  projectCommands: string
  stepCommands?: string
  log?: (text: string) => void
  signal?: AbortSignal
  runId?: number
}

// The plan is made inside the operation: waiting for the project's base database already counts as booting.
export function bootSessionEnv(sessionId: number, plan: () => Promise<BootPlan>): Promise<void> {
  return inMailbox(sessionId, 'booting', async () => bootEnv(sessionId, await plan()))
}

// A half-booted stack would otherwise idle until the reaper reclaims it. The workspace of an up
// code session keeps running until the boot is done, so a cancel leaves the session as it was.
export async function bootEnv(sessionId: number, bootPlan: BootPlan): Promise<void> {
  const signals = [bootPlan.signal, operationSignal(sessionId)].filter(s => !!s)
  const plan = { ...bootPlan, signal: signals.length ? AbortSignal.any(signals) : undefined }
  const before = getSessionRow(sessionId)
  const log = plan.log ?? (() => {})
  const exec = async (command: string[], env?: Record<string, string>) => (await streamInSandbox(sessionId, command, log, env, plan.signal)).code
  // The dev server stays untagged: it outlives the run that started it.
  const runExec = (command: string[]) => exec(command, plan.runId === undefined ? undefined : runTag(plan.runId))
  warmPreviewCertificates(sessionId)
  const showStopping = () => relabelOperation(sessionId, 'booting', 'stopping')
  plan.signal?.addEventListener('abort', showStopping, { once: true })
  try {
    if (plan.dbArchive) {
      log(`\n▶ Restoring the archived database\n`)
      await restoreDbVolume(sessionId, plan.dbArchive)
    }
    else if (plan.dbBase) {
      log(`\n▶ Copying the database from the project's base (${plan.dbBase.database})\n`)
      await cloneDbBase(sessionId, plan.dbBase)
    }
    plan.signal?.throwIfAborted()
    await startEnvStack(sessionId, log, plan.signal)
    if (plan.dbFile) {
      log(`\n▶ import-db (${basename(plan.dbFile)})\n`)
      const code = await runExec(['ddev', 'import-db', `--file=${plan.dbFile}`])
      if (code !== 0) throw new Error(`ddev import-db exited with code ${code}`)
    }
    if (plan.projectCommands.trim()) log(`\nBoot commands (project settings):\n`)
    await runSetupCommands(plan.projectCommands, c => runExec(['bash', '-lc', c]), log, plan.signal)
    if (plan.stepCommands?.trim()) log(`\nAdditional setup commands (this workflow's boot step):\n`)
    await runSetupCommands(plan.stepCommands, c => runExec(['bash', '-lc', c]), log, plan.signal)
    const port = getSessionRow(sessionId)?.previewPort
    if (port != null) {
      log(`\n▶ Starting the dev server on port ${port}\n`)
      const since = new Date()
      try {
        await restartDevServer(exec)
        await waitForDevServer(sessionId, port, plan.signal)
      }
      catch (e) {
        const output = await devServerOutput(sessionId, since).catch(() => '')
        if (output.trim()) log(`\n▶ Dev server output (last lines)\n${output.trimEnd()}\n`)
        throw e
      }
      await noteDevServerUse(sessionId, log)
    }
    plan.signal?.throwIfAborted()
    await removeWorkspace(sessionId)
    envEvent(sessionId, 'boot')
  }
  catch (e) {
    await stopEnvStack(sessionId).catch(() => {})
    // A step timeout aborts the same signal, but it is a failure.
    const cancelled = plan.signal?.aborted && plan.signal.reason?.name !== 'TimeoutError' && !!getSessionRow(sessionId)
    // A failed boot leaves nothing running.
    if (!cancelled || before?.tier !== 'code') {
      await removeWorkspace(sessionId).catch(() => {})
      tryEnvEvent(sessionId, 'failBoot')
    }
    if (cancelled && getSessionRow(sessionId)?.envState === before?.envState) log(`\n▶ Boot cancelled, the environment is back to how it was\n`)
    throw e
  }
  finally {
    plan.signal?.removeEventListener('abort', showStopping)
  }
}

async function runSetupCommands(
  commands: string | undefined,
  exec: (command: string) => Promise<number>,
  log: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const lines = (commands ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  for (const command of lines) {
    signal?.throwIfAborted()
    log(`\n▶ ${command}\n`)
    const code = await exec(command)
    if (code !== 0) throw new Error(`'${command}' exited with code ${code}`)
  }
}

// Also applies a changed environment definition or new mounts.
export function rebootEnv(sessionId: number): Promise<void> {
  return inMailbox(sessionId, 'rebooting', () => reboot(sessionId))
}

async function reboot(sessionId: number): Promise<void> {
  // Regenerate first, or the reboot runs on the original boot's compose override.
  const session = getSessionRow(sessionId)
  const project = session && getProject(session.projectId)
  const dir = sessionCheckoutDir(sessionId)
  if (!session) throw new Error('Session not found')
  // Callers check the state before queueing: an archive may have come in between.
  if (session.envState === 'archived' || session.envState === 'down') throw new Error(`Session ${sessionId} is ${session.envState}, so it cannot reboot`)
  const signal = operationSignal(sessionId)
  try {
    if (project && existsSync(dir)) {
      pinDevServerPort(sessionId, await configureEnv(dir, project, sessionId, session.urlMode ?? 'rewrite'))
    }
    signal?.throwIfAborted()
    await startSandbox(sessionId, session.tier, true, undefined, signal)
    signal?.throwIfAborted()
  }
  catch (e) {
    // Cancelled: whatever started goes again, and the session ends stopped.
    if (signal?.aborted) {
      await (session.tier === 'preview' ? stopEnvStack(sessionId) : removeWorkspace(sessionId)).catch(() => {})
      tryEnvEvent(sessionId, 'stop')
    }
    throw e
  }
  if (!tryEnvEvent(sessionId, 'start')) touchSessionPreview(sessionId)
}

async function startSandbox(sessionId: number, tier: SessionTier, fresh: boolean, log?: (text: string) => void, signal?: AbortSignal): Promise<void> {
  if (tier === 'preview') {
    if (fresh || !await envStackRunning(sessionId)) await startEnvStack(sessionId, log, signal)
    return
  }
  if (fresh) await removeWorkspace(sessionId)
  await ensureWorkspaceUp(sessionId)
}

async function configureEnv(dir: string, project: Project, sessionId: number, urlMode: 'env' | 'rewrite'): Promise<number | null> {
  const { warnings, devServerPort } = await configureSessionEnv(dir, project, sessionId, urlMode)
  for (const warning of warnings) console.warn(`[envs] session ${sessionId}: ${warning}`)
  return devServerPort
}

function pinDevServerPort(sessionId: number, port: number | null): void {
  updateSession(sessionId, { previewPort: port })
}

export async function rehydrateEnv(sessionId: number, log: (text: string) => void = () => {}): Promise<void> {
  await inMailbox(sessionId, 'restoring', () => restoreFromArchive(sessionId, log))
}

async function restoreFromArchive(sessionId: number, log: (text: string) => void): Promise<void> {
  const signal = operationSignal(sessionId)
  try {
    await restore(sessionId, log, signal)
  }
  catch (e) {
    // Cancelled: back to archived. The archive stays, only what was unpacked or started goes.
    if (signal?.aborted && getSessionRow(sessionId)?.envState === 'archived') await teardownSession(sessionId).catch(() => {})
    throw e
  }
}

async function restore(sessionId: number, log: (text: string) => void, signal: AbortSignal | undefined): Promise<void> {
  const session = getSessionRow(sessionId)
  const project = session && getProject(session.projectId)
  if (!session || !project) throw new Error('Session or project not found')

  const dir = sessionCheckoutDir(sessionId)
  const checkoutArchive = join(sessionArchiveDir(sessionId), 'checkout.tar.gz')
  const legacyGitArchive = join(sessionArchiveDir(sessionId), 'git.tar.gz')
  if (existsSync(checkoutArchive)) {
    // Unpack on every attempt: a crash in between must not look like a finished restore.
    mkdirSync(dir, { recursive: true })
    await execa('tar', ['-xzf', checkoutArchive, '-C', dir])
  }
  else if (existsSync(legacyGitArchive)) {
    await restoreLegacyCheckout(sessionId, dir, legacyGitArchive)
  }
  else if (existsSync(join(dir, '.git'))) {
    // Keep the prior fallback clone.
  }
  else {
    log(`The archived state of this session is gone, so its uncommitted and unpushed work could not be restored\n`)
    const credentials = await gitProvider(project).credentials(project)
    const base = sessionBase(session, project)
    await prepareSessionCheckout(project, sessionId, credentials, log, session.branch ?? base, base)
  }
  signal?.throwIfAborted()

  // Only when the checkout has none yet: a retry must keep the live state.
  const stateArchive = join(sessionArchiveDir(sessionId), 'knecht-state.tar.gz')
  if (existsSync(stateArchive) && !existsSync(join(dir, '.knecht'))) {
    await execa('tar', ['-xzf', stateArchive, '-C', dir])
  }
  pinDevServerPort(sessionId, await configureEnv(dir, project, sessionId, session.urlMode ?? 'rewrite'))
  signal?.throwIfAborted()

  const bootStep = lastBootStep(sessionId)
  if (session.tier === 'preview' || bootStep) {
    await bootEnv(sessionId, {
      ...await dbSource(sessionId, project),
      projectCommands: bootStep ? project.bootCommands : '',
      stepCommands: bootStep?.commands,
    })
  }
  else {
    await ensureWorkspaceUp(sessionId)
    envEvent(sessionId, 'restore')
  }
}

// Archives written before checkout.tar.gz: the .git plus the staged diff. The .git came from
// the sandbox, so git runs in a container, never on the host. Not the workspace: it needs
// the env config that only the restored tree can produce.
async function restoreLegacyCheckout(sessionId: number, dir: string, gitArchive: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  await execa('tar', ['-xzf', gitArchive, '-C', dir])
  // Reset and clean first, so a retry applies the patch onto the same tree.
  await runOnCheckout(sessionId, ['git', 'reset', '--hard'])
  await runOnCheckout(sessionId, ['git', 'clean', '-fdq'])
  const patch = join(sessionArchiveDir(sessionId), 'checkout.patch')
  if (existsSync(patch)) {
    await runOnCheckout(sessionId, ['git', 'apply'], readFileSync(patch, 'utf8'))
  }
}

export function reviveEnv(sessionId: number, log?: (text: string) => void, { bootLostPreview = true } = {}): Promise<void> {
  return inMailbox(sessionId, null, () => revive(sessionId, log, bootLostPreview))
}

async function revive(sessionId: number, log: ((text: string) => void) | undefined, bootLostPreview: boolean): Promise<void> {
  const session = getSessionRow(sessionId)
  if (!session || session.envState === 'down') throw new Error('The session has no checkout')
  if (session.envState === 'archived') return asOperation(sessionId, 'restoring', () => restoreFromArchive(sessionId, log ?? (() => {})))
  if (bootLostPreview && previewLost(sessionId)) return rebootLostPreview(sessionId, log)
  if (session.envState === 'stopped') return asOperation(sessionId, 'rebooting', () => reboot(sessionId))
  await startSandbox(sessionId, session.tier, false, log)
  touchSessionPreview(sessionId)
}

// A stopped preview stays stopped: the caller gets a workspace of its own instead.
export function reviveWithoutPreview(sessionId: number, log?: (text: string) => void): Promise<{ inWorkspace: boolean }> {
  return inMailbox(sessionId, null, async () => {
    const session = getSessionRow(sessionId)
    // A stopped session stays stopped: the run's boot step may start it next.
    if (!session || session.envState === 'archived' || (session.tier === 'code' && session.envState !== 'stopped')) {
      await revive(sessionId, log, false)
      return { inWorkspace: false }
    }
    if (session.envState === 'up' && await envStackRunning(sessionId)) {
      touchSessionPreview(sessionId)
      return { inWorkspace: false }
    }
    await ensureWorkspaceUp(sessionId)
    return { inWorkspace: true }
  })
}

// A code session revived meanwhile owns the workspace now, so it stays.
export function releaseWorkspace(sessionId: number): Promise<void> {
  return inMailbox(sessionId, null, async () => {
    const session = getSessionRow(sessionId)
    if (session?.tier === 'code' && session.envState === 'up') return
    await removeWorkspace(sessionId)
  })
}

export function applyEnvDefinition(sessionId: number, log: (text: string) => void): Promise<void> {
  // A transition under way boots from the regenerated definition or leaves the env down.
  if (envOperation(sessionId)) return Promise.resolve()
  return inMailbox(sessionId, null, async () => {
    const session = getSessionRow(sessionId)
    if (session?.envState !== 'up') return
    await (session.tier === 'preview' ? startEnvStack(sessionId, log) : removeWorkspace(sessionId))
  })
}

// An expired archive resets the tier, so a later checkout comes back as a bare workspace.
export function previewLost(sessionId: number): boolean {
  return getSessionRow(sessionId)?.tier === 'code' && !!lastBootStep(sessionId)
}

function rebootLostPreview(sessionId: number, log?: (text: string) => void): Promise<void> {
  return asOperation(sessionId, 'booting', async () => {
    const session = getSessionRow(sessionId)
    const project = session && getProject(session.projectId)
    if (!session || !project) throw new Error('Session or project not found')
    const dir = sessionCheckoutDir(sessionId)
    if (existsSync(dir)) pinDevServerPort(sessionId, await configureEnv(dir, project, sessionId, session.urlMode ?? 'rewrite'))
    await bootEnv(sessionId, {
      ...await dbSource(sessionId, project),
      projectCommands: project.bootCommands,
      stepCommands: lastBootStep(sessionId)?.commands,
      log,
    })
  })
}

function lastBootStep(sessionId: number): { commands?: string } | null {
  const row = lastSuccessfulSessionStep(sessionId, 'ddev-start')
  return row ? (row.params ?? {}) as { commands?: string } : null
}

// No restart policy on containers (per-container policies leave a stack with
// add-on services half-up), so every 'up' preview gets an unconditional `ddev start`.
// A code session's workspace starts lazily on its next use.
export function reconcileEnvStates(): Promise<void> {
  const interrupted = listSessionsWithEnvOperation()
  const up = listSessionsInEnvState('up').filter(s => !s.envOperation)
  // Every mailbox is claimed before anything else can queue on it; the sessions still go one at a time.
  let previous: Promise<void> = Promise.resolve()
  for (const { id } of [...interrupted, ...up]) {
    const prior = previous
    previous = inMailbox(id, null, async () => {
      await prior
      await reconcileSession(id)
    })
  }
  return previous
}

async function reconcileSession(sessionId: number): Promise<void> {
  const session = getSessionRow(sessionId)
  if (!session) return
  if (session.envOperation) return finishInterrupted(sessionId, session.envOperation)
  try {
    if (session.tier === 'preview') {
      await startEnvStack(sessionId)
      touchSessionPreview(sessionId)
    }
    // A code session owns no ddev stack; one still running was started without its boot.
    else if (await envStackRunning(sessionId)) {
      await stopEnvStack(sessionId)
    }
  }
  catch (err) {
    forgetPreview(sessionId)
    tryEnvEvent(sessionId, 'stop')
    console.error(`[envs] boot restore of session ${sessionId} failed, marked stopped:`, err)
  }
}

// An archive or expiry was already decided, so it is done again; anything else is undone to stopped.
async function finishInterrupted(sessionId: number, operation: EnvTransition): Promise<void> {
  try {
    if (operation === 'expiring') {
      await teardownSession(sessionId)
      rmSync(sessionArchiveDir(sessionId), { recursive: true, force: true })
      tryEnvEvent(sessionId, 'expire')
    }
    else if (operation === 'archiving') {
      // Past the snapshot, the teardown may have half-deleted the checkout: a new tar would replace the good one.
      if (!existsSync(snapshotMarker(sessionId))) await snapshotSession(sessionId)
      await teardownSession(sessionId)
      tryEnvEvent(sessionId, 'archive')
    }
    else {
      if (await envStackRunning(sessionId)) await stopEnvStack(sessionId)
      await removeWorkspace(sessionId)
      forgetPreview(sessionId)
      tryEnvEvent(sessionId, 'stop')
    }
  }
  catch (err) {
    console.error(`[envs] finishing the interrupted ${operation} of session ${sessionId} failed:`, err)
  }
  finally {
    updateSession(sessionId, { envOperation: null })
  }
}

export function stopEnv(sessionId: number, { byHand = false, idleBefore }: { byHand?: boolean, idleBefore?: Date } = {}): Promise<void> {
  return inMailbox(sessionId, 'stopping', async () => {
    const session = getSessionRow(sessionId)
    if (!session) return
    // Whatever ran ahead of it in the mailbox may have put the session back to use.
    if (idleBefore && !(session.envState === 'up' && session.previewLastSeen && session.previewLastSeen < idleBefore)) return
    // Any state: containers a state no longer accounts for must stay stoppable.
    if (session.tier === 'preview') {
      // `ddev stop` on an unregistered project fails and would wedge the env in 'up'.
      if (await envStackRunning(sessionId)) await stopEnvStack(sessionId)
    }
    else {
      await removeWorkspace(sessionId)
    }
    tryEnvEvent(sessionId, 'stop', byHand ? { wakeOnVisit: false } : {})
  })
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
      if (envOperation(id)) continue
      await stopEnv(id, { idleBefore: cutoff })
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
  for (const { id } of stale) {
    try {
      await archiveEnv(id)
    }
    catch (err) {
      console.error(`[envs] archiving session ${id} failed, it stays stopped:`, err)
    }
  }
}

export async function archiveEnv(sessionId: number, { byHand = false } = {}): Promise<void> {
  await inMailbox(sessionId, 'archiving', async () => {
    if (!stillIn(sessionId, 'stopped') || sessionHasActiveRun(sessionId) || sessionHasActiveFollowup(sessionId)) return
    await snapshotSession(sessionId)
    await teardownSession(sessionId)
    envEvent(sessionId, 'archive', byHand ? { wakeOnVisit: false } : {})
  })
}

function snapshotMarker(sessionId: number): string {
  return join(sessionArchiveDir(sessionId), 'snapshot.complete')
}

// A restore keeps the archive, so the marker of an earlier archive is cleared first.
async function snapshotSession(sessionId: number): Promise<void> {
  rmSync(snapshotMarker(sessionId), { force: true })
  await snapshotCheckout(sessionId)
  await snapshotDb(sessionId)
  mkdirSync(sessionArchiveDir(sessionId), { recursive: true })
  writeFileSync(snapshotMarker(sessionId), '')
}

const REINSTALLABLE_DIRS = ['vendor', 'node_modules']

// Only when the repo ignores them: a committed vendor/ must survive the restore.
function ignoredReinstallableDirs(dir: string): string[] {
  const gitignore = join(dir, '.gitignore')
  const lines = existsSync(gitignore) ? readFileSync(gitignore, 'utf8').split('\n').map(l => l.trim()) : []
  return REINSTALLABLE_DIRS.filter(name => [name, `${name}/`, `/${name}`, `/${name}/`].some(p => lines.includes(p)))
}

// Plain tar, never git: the sandbox can write .git, and host-side git would run its hooks and config.
// The whole tree keeps unpushed commits and uncommitted work; a branch-tip clone would lose them.
async function snapshotCheckout(sessionId: number): Promise<void> {
  const dir = sessionCheckoutDir(sessionId)
  if (!existsSync(join(dir, '.git'))) return
  const archiveDir = sessionArchiveDir(sessionId)
  mkdirSync(archiveDir, { recursive: true })
  // .knecht is separate so a retried restore keeps the live agent state.
  const excludes = ['.knecht', ...ignoredReinstallableDirs(dir)].map(name => `--exclude=./${name}`)
  // Renamed into place: a half-written archive must not look restorable.
  const partial = join(archiveDir, 'checkout.tar.gz.partial')
  await execa('tar', ['-czf', partial, ...excludes, '-C', dir, '.'])
  renameSync(partial, join(archiveDir, 'checkout.tar.gz'))
  if (existsSync(join(dir, '.knecht'))) {
    await execa('tar', ['-czf', join(archiveDir, 'knecht-state.tar.gz'), '-C', dir, '.knecht'])
  }
}

async function snapshotDb(sessionId: number): Promise<void> {
  try {
    mkdirSync(sessionArchiveDir(sessionId), { recursive: true })
    await archiveDbVolume(sessionId, sessionArchiveDir(sessionId))
  }
  catch {
    // Restore falls back to the project's base or dump.
  }
}

export async function reapExpiredArchives(): Promise<void> {
  const { archiveRetentionDays } = getSettings()
  if (archiveRetentionDays <= 0) return
  const cutoff = new Date(Date.now() - archiveRetentionDays * 86_400_000)
  const expired = listSessionsInEnvState('archived', { seenBefore: cutoff })
  for (const { id } of expired) {
    try {
      await inMailbox(id, 'expiring', async () => {
        if (!stillIn(id, 'archived')) return
        // A failed restore can leave an unpacked checkout behind.
        await teardownSession(id)
        rmSync(sessionArchiveDir(id), { recursive: true, force: true })
        envEvent(id, 'expire')
      })
    }
    catch {
      // Retried on the next tick.
    }
  }
}

async function dbSource(sessionId: number, project: Project): Promise<Pick<BootPlan, 'dbFile' | 'dbBase' | 'dbArchive'>> {
  const dbArchive = archivedDbVolume(sessionArchiveDir(sessionId))
  if (dbArchive) return { dbFile: null, dbArchive }
  const archived = join(sessionArchiveDir(sessionId), 'db.sql.gz')
  if (existsSync(archived)) return { dbFile: archived }
  const dbBase = await readyDbBase(project.id, sessionCheckoutDir(sessionId))
  if (dbBase) return { dbFile: null, dbBase }
  const fallback = project.dbDumpPath && join(projectDumpDir(project.id), basename(project.dbDumpPath))
  return { dbFile: fallback && existsSync(fallback) ? fallback : null }
}

// After the session's row is deleted: what is still queued is refused, and the operation under way
// is aborted and winds down first, so it cannot bring back what the teardown removed.
export async function deleteEnv(sessionId: number): Promise<void> {
  abortOperation(sessionId)
  await mailboxDrained(sessionId)
  await teardownSession(sessionId)
  rmSync(sessionArchiveDir(sessionId), { recursive: true, force: true })
}

export async function teardownSession(sessionId: number): Promise<void> {
  await removeEnvStack(sessionId)
  await removeWorkspace(sessionId)
  rmSync(sessionCheckoutDir(sessionId), { recursive: true, force: true })
}
