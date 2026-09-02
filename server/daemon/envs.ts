import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import { getSettings } from '../utils/settings'
import { getProject, getSessionRow } from '../utils/entities'
import { getInstallationToken } from '../utils/github-app'
import { projectDumpDir, sessionArchiveDir, sessionCheckoutDir } from '../utils/storage'
import { joinBootCommands, runSetupCommands } from '../workflows/actions/ddev-start'
import { configureSessionEnv, readDdevConfig } from './ddev'
import { restartDevServer, waitForDevServer } from './dev-server'
import { prepareSessionCheckout } from './git'
import { envStackRunning, execInSandbox, forgetPreview, removeEnvStack, startEnvStack, stopEnvStack } from './sandbox'

// Lifecycle of the per-session environments: the ONE place that moves
// envState. Envs walk down a retention ladder that trades disk for restore
// time:
//
//   up ─idleStopMinutes─▶ stopped ─previewRetentionDays─▶ archived ─archiveRetentionDays─▶ down
//      (DB exported on          (volumes + checkout (               (archive deleted;
//       the way down;            the GBs) deleted; DB               only a re-run
//       containers gone,         export + the checkout's            boots it again)
//       volumes kept)            .git + uncommitted patch
//                                + .knecht state (MBs) kept)
//
// Reactivation: 'stopped' reboots in seconds (rebootEnv: `ddev start` revives
// the containers around the kept volumes); 'archived' is restored exactly:
// the archived .git is unpacked and reset (offline, keeps unpushed commits),
// the uncommitted patch re-applied, the .knecht agent state (the session's
// conversation) unpacked, fresh stack, the session's own DB export
// re-imported (rehydrateEnv). All timeouts are operator settings
// (server/utils/settings.ts).

// Bring a session's env up before project-facing work: start its ddev stack
// if it isn't running, mark it previewable. Idempotent; the running check
// keeps the per-step calls cheap (a no-op `ddev start` still takes seconds).
export async function ensureEnvUp(sessionId: number): Promise<void> {
  if (!await envStackRunning(sessionId)) await startEnvStack(sessionId)
  markUp(sessionId)
}

// Restart an idle-stopped env: the volumes (the imported DB) and the checkout
// survived the stop, so `ddev start` brings it back without re-running the
// workflow.
export async function rebootEnv(sessionId: number): Promise<void> {
  // Refresh the knecht ddev config first: the compose override evolves with
  // Knecht (tool mounts like the IDE server, resource limits), and a reboot
  // must pick up its current shape, not the one from the session's original
  // boot.
  const session = getSessionRow(sessionId)
  const project = session && getProject(session.projectId)
  const dir = sessionCheckoutDir(sessionId)
  if (session && project && existsSync(dir)) {
    pinDevServerPort(sessionId, configureEnv(dir, project, sessionId, session.urlMode ?? 'rewrite'))
  }
  await startEnvStack(sessionId)
  markUp(sessionId)
}

// configureSessionEnv for the paths without a run log: the detectors'
// warnings go to the server log instead, so a checkout whose files changed
// since the boot does not fail silently. Returns the dev server port the
// container was just built for.
function configureEnv(dir: string, project: Project, sessionId: number, urlMode: 'env' | 'rewrite'): number | null {
  const { warnings, devServerPort } = configureSessionEnv(dir, project, sessionId, urlMode)
  for (const warning of warnings) console.warn(`[envs] session ${sessionId}: ${warning}`)
  return devServerPort
}

// The pin the preview proxy, the ws pipe and the boot step's dev server
// restart read: re-set on every boot path, so it always matches the
// container that was just built (daemon/ddev.ts configureSessionEnv).
function pinDevServerPort(sessionId: number, port: number | null): void {
  db.update(schema.sessions).set({ previewPort: port }).where(eq(schema.sessions.id, sessionId)).run()
}

// Restore an archived env exactly: unpack the archived .git and reset the
// working tree from it (offline, and it carries the session's branch, config
// and every commit the session made, pushed or not), re-apply the uncommitted
// diff, unpack the .knecht agent state (the conversation continues where it
// was), start a fresh stack, import the session's own DB export (falling back
// to the project dump for archives without one) and re-run the boot step's
// setup commands, which rebuild what the archive doesn't carry (vendor/ and
// other gitignored artifacts). An archive whose .git snapshot is missing (the
// best-effort snapshot failed) falls back to a fresh clone at the branch tip.
// Takes minutes, the price of archives costing MBs instead of GBs.
export async function rehydrateEnv(sessionId: number): Promise<void> {
  const session = getSessionRow(sessionId)
  const project = session && getProject(session.projectId)
  if (!session || !project) throw new Error('Session or project not found')

  const dir = sessionCheckoutDir(sessionId)
  const gitArchive = join(sessionArchiveDir(sessionId), 'git.tar.gz')
  if (existsSync(gitArchive)) {
    // The archived .git is the exact object store. (Re)unpack and reset the
    // working tree from it on every attempt, so a crash between the extract and
    // the reset can't strand the checkout with an empty tree that a later
    // attempt mistakes for a finished restore. Idempotent: the reset --hard
    // below re-materializes HEAD, and the patch is re-applied onto it.
    mkdirSync(dir, { recursive: true })
    await execa('tar', ['-xzf', gitArchive, '-C', dir])
    await execa('git', ['-C', dir, 'reset', '--hard'])
  }
  else if (existsSync(join(dir, '.git'))) {
    // No .git snapshot (best-effort miss): a prior fallback clone is here, keep it.
  }
  else {
    const token = await getInstallationToken(project.owner, project.name)
    await prepareSessionCheckout(project, sessionId, token, () => {}, session.branch ?? project.defaultBranch)
  }

  // Re-apply the uncommitted changes saved at archive time, only onto a clean
  // checkout, so a retry after a half-done restore doesn't apply them twice.
  const patch = join(sessionArchiveDir(sessionId), 'checkout.patch')
  if (existsSync(patch)) {
    const { stdout: status } = await execa('git', ['-C', dir, 'status', '--porcelain'])
    if (!status.trim()) await execa('git', ['-C', dir, 'apply', patch])
  }

  // The session's agent state (.knecht: opencode config + the conversation
  // DB) is git-excluded, so it rides its own tarball. Restored only when the
  // checkout has none yet (a retry keeps the live state), so a follow-up
  // after the restore continues the conversation instead of starting blank.
  const stateArchive = join(sessionArchiveDir(sessionId), 'knecht-state.tar.gz')
  if (existsSync(stateArchive) && !existsSync(join(dir, '.knecht'))) {
    await execa('tar', ['-xzf', stateArchive, '-C', dir])
  }
  const devServerPort = configureEnv(dir, project, sessionId, session.urlMode ?? 'rewrite')
  pinDevServerPort(sessionId, devServerPort)

  await startEnvStack(sessionId)
  try {
    await importArchivedDb(sessionId, project)
    await rerunBootSetup(sessionId, project)
    // The dev server's daemon died while node_modules were still missing
    // (daemon/dev-server.ts): same restart as the boot step.
    if (devServerPort !== null) {
      await restartDevServer(async command => (await execInSandbox(sessionId, command, { reject: false })).exitCode ?? 1)
      await waitForDevServer(sessionId, devServerPort)
    }
  }
  catch (e) {
    // A half-restored stack must not keep running under envState 'archived':
    // no reaper reclaims that state, and the next restore would boot a second
    // stack on top. Stop the containers again (the unpacked checkout and the
    // archive stay for the retry) and surface the failure.
    await stopEnvStack(sessionId)
    throw e
  }
  markUp(sessionId)
}

// Bring a session's env back for new work, from whatever rung of the ladder
// it sits on: 'archived' needs the full restore, 'stopped' restarts its
// containers, anything else just makes sure the stack is up (an 'up' env
// gets its idle clock reset). The one revive path shared by the follow-up
// executor and POST /api/runs/:id/reboot.
export async function reviveEnv(sessionId: number): Promise<void> {
  const state = getSessionRow(sessionId)?.envState
  if (state === 'archived') await rehydrateEnv(sessionId)
  else if (state === 'stopped') await rebootEnv(sessionId)
  else await ensureEnvUp(sessionId)
}

// Re-run the boot commands (composer install and friends) after a restore:
// the archive keeps only git-visible state plus the DB export and .knecht,
// so everything gitignored (vendor/, node_modules/, a generated .env) died
// with the teardown and must be rebuilt the way the original boot built it:
// the project's CURRENT boot commands plus the workflow extras from the
// session's last executed ddev-start row. A session without a successful
// boot step never had a preview: nothing to redo.
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

// Make reality match envState after a daemon boot: a host reboot kills the
// containers of every 'up' env (they have no restart policy, deliberately:
// projects bring unknown add-on services, so per-container policies could
// only ever cover part of a stack and would leave it half-up). envState is
// the desired state and this is its restore pass: every 'up' session gets an
// unconditional `ddev start`, which merges ALL of the project's compose
// files and therefore revives every service, add-ons included; on a stack
// that is already running it is a cheap no-op. A session whose start fails
// (broken volume, missing checkout) is downgraded to 'stopped', the honest
// state, where the workspace offers the Reboot button. Sessions already
// 'stopped'/'archived'/'down' are not touched: the retention ladder and a
// deliberate stop survive reboots unchanged. Most recently used first, so
// the previews someone is waiting for come back first.
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

// The env is up and previewable now, even if later steps fail. Also resets
// the idle clock so the reaper doesn't stop what was just booted.
function markUp(sessionId: number): void {
  db.update(schema.sessions)
    .set({ envState: 'up', previewLastSeen: new Date() })
    .where(eq(schema.sessions.id, sessionId))
    .run()
}

// Stop a session's env: export its database into the session archive while
// the stack is still up, then stop it (containers removed, volumes and
// checkout kept, so it can be rebooted quickly). Guarded: the export makes a
// stop take a while, and the reaper tick must not pile a second stop onto a
// session mid-export. Failures propagate (envState stays 'up'): the stop
// endpoint reports them, the idle reaper catches per session and retries on
// its next tick.
const stopping = new Set<number>()
export async function stopEnv(sessionId: number): Promise<void> {
  if (stopping.has(sessionId)) return
  stopping.add(sessionId)
  try {
    await exportSessionDb(sessionId)
    // A session whose stack never came up has nothing to stop; `ddev stop` on
    // an unregistered project would fail and wedge the env in 'up' forever.
    if (await envStackRunning(sessionId)) await stopEnvStack(sessionId)
    db.update(schema.sessions).set({ envState: 'stopped' }).where(eq(schema.sessions.id, sessionId)).run()
  }
  finally {
    stopping.delete(sessionId)
  }
}

// Export the env's CURRENT database into the session's archive. The DB can
// only change while the env is 'up', so exporting on the way down always
// captures the latest state, each stop overwrites the previous export. The
// ddev CLI runs host-side, so it writes the archive file directly.
// Best-effort: a session whose ddev never came up has nothing to export, and
// that must not block the stop. A stack without a db container (a generated
// environment) is skipped outright instead of paying a failing ddev call.
async function exportSessionDb(sessionId: number): Promise<void> {
  if (readDdevConfig(sessionCheckoutDir(sessionId))?.hasDb === false) return
  try {
    mkdirSync(sessionArchiveDir(sessionId), { recursive: true })
    await execInSandbox(sessionId, ['ddev', 'export-db', `--file=${join(sessionArchiveDir(sessionId), 'db.sql.gz')}`])
  }
  catch {
    // No (working) DB to export: restore falls back to the project dump.
  }
}

// Stop envs that have been idle (no preview access) longer than the configured
// timeout. This is the RAM guard: each 'up' env keeps a web + db container
// running. A session with a step still executing (workflow or follow-up) is
// not idle no matter how stale its preview timestamp: stopping would SIGKILL
// the agent working inside (exit 137). Its idle clock is bumped instead, so
// the env stays up a full window after the step finishes. Stale 'running'
// rows cannot pin an env forever: plugins/runs-recover.ts closes them at boot.
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
      // Leave envState as-is; retried on the next tick.
    }
  }
}

// Archive envs that have been 'stopped' (untouched) longer than the preview
// retention: snapshot what the teardown would lose (the checkout's HEAD + its
// uncommitted diff + the .knecht agent state; the DB export was already taken
// at stop time), then delete the sandbox and checkout. 0 keeps stopped envs
// until the session is deleted.
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

// Archive one stopped env: snapshot, teardown, mark archived. Shared by the
// retention reaper above and the run page's "archive now" action.
export async function archiveEnv(sessionId: number): Promise<void> {
  await snapshotCheckout(sessionId)
  await teardownSession(sessionId)
  db.update(schema.sessions).set({ envState: 'archived' }).where(eq(schema.sessions.id, sessionId)).run()
}

// Record what the teardown is about to delete from the checkout: its HEAD
// (the fallback restore point), any uncommitted changes as a binary patch,
// the whole .git dir, and the .knecht agent state (the session's
// conversation, which must survive archiving; ADR 0006). The .git tarball is
// what makes the restore exact: the session's clone IS its object store, so
// commits that were never pushed would die with the teardown otherwise.
// `.ddev/config.knecht.yaml` is excluded via the clone's info/exclude and
// regenerated on restore, so no secrets enter the patch.
async function snapshotCheckout(sessionId: number): Promise<void> {
  const dir = sessionCheckoutDir(sessionId)
  const gitDir = join(dir, '.git')
  if (!existsSync(gitDir)) return
  try {
    const { stdout: sha } = await execa('git', ['-C', dir, 'rev-parse', 'HEAD'])
    db.update(schema.sessions).set({ commitSha: sha.trim() }).where(eq(schema.sessions.id, sessionId)).run()
    await execa('git', ['-C', dir, 'add', '-A'])
    mkdirSync(sessionArchiveDir(sessionId), { recursive: true })
    // Snapshot the object store FIRST: it carries every commit the session
    // made and is what makes the restore exact. Taken before the
    // (maxBuffer-capped) diff so an oversized uncommitted diff that throws
    // still leaves a restorable .git rather than falling back to a
    // branch-tip clone that loses commits.
    await execa('tar', ['-czf', join(sessionArchiveDir(sessionId), 'git.tar.gz'), '-C', dir, '.git'])
    if (existsSync(join(dir, '.knecht'))) {
      await execa('tar', ['-czf', join(sessionArchiveDir(sessionId), 'knecht-state.tar.gz'), '-C', dir, '.knecht'])
    }
    // Keep the final newline: execa strips it by default, and `git apply`
    // rejects a patch whose last hunk line lost it ("corrupt patch").
    const { stdout: patch } = await execa('git', ['-C', dir, 'diff', '--cached', '--binary'], { maxBuffer: 256 * 1024 * 1024, stripFinalNewline: false })
    if (patch.trim()) {
      writeFileSync(join(sessionArchiveDir(sessionId), 'checkout.patch'), patch)
    }
  }
  catch {
    // Best-effort: the restore then falls back to the branch tip, no patch.
  }
}

// Delete archives untouched longer than the archive retention; after this
// only a re-run gets a fresh environment, and the session's conversation is
// gone (the next one starts seeded from the thread and durable state).
// 0 keeps archives until the session is deleted.
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
    // previewReady falls with the archive: the next run in this session must
    // boot from scratch (fresh clone, DB import, setup commands) instead of
    // the boot step treating the session as already booted.
    db.update(schema.sessions).set({ envState: 'down', previewReady: false }).where(eq(schema.sessions.id, id)).run()
  }
}

// Import the session's archived DB export into a freshly restored env;
// archives without one (the export never succeeded) fall back to the
// project's dump. The ddev CLI runs host-side and reads the file itself, no
// copy step.
async function importArchivedDb(sessionId: number, project: Project): Promise<void> {
  const archived = join(sessionArchiveDir(sessionId), 'db.sql.gz')
  const fallback = project.dbDumpPath && join(projectDumpDir(project.id), basename(project.dbDumpPath))
  const file = existsSync(archived) ? archived : fallback && existsSync(fallback) ? fallback : null
  if (!file) return
  await execInSandbox(sessionId, ['ddev', 'import-db', `--file=${file}`])
}

// Fully tear down a session's isolated environment: remove its ddev stack
// (containers, volumes, project registration) and its checkout. Best-effort
// so a half-gone env still gets cleaned up.
export async function teardownSession(sessionId: number): Promise<void> {
  await removeEnvStack(sessionId)
  rmSync(sessionCheckoutDir(sessionId), { recursive: true, force: true })
}
