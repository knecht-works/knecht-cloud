import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import { and, eq, lt } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import { getSettings } from '../utils/settings'
import { getProject, getRun } from '../utils/entities'
import { getInstallationToken } from '../utils/github-app'
import { projectCheckoutDir, projectDumpDir, runArchiveDir, runWorktreeDir } from '../utils/storage'
import { writeDdevConfig } from './ddev'
import { prepareRunCheckout } from './git'
import { bootSandbox, copyIntoSandbox, copyOutOfSandbox, execInSandbox, removeSandbox, stopSandbox } from './sandbox'

// Lifecycle of the per-run environments: the ONE place that moves envState.
// Envs walk down a retention ladder that trades disk for restore time:
//
//   up ─idleStopMinutes─▶ stopped ─previewRetentionDays─▶ archived ─archiveRetentionDays─▶ down
//      (DB exported on          (sandbox + worktree (               (archive deleted;
//       the way down;            the GBs) deleted; DB               only a re-run
//       sandbox kept)            export + worktree patch             boots it again)
//                                (MBs) kept)
//
// Reactivation: 'stopped' reboots in seconds (rebootEnv); 'archived' is
// restored exactly: worktree at the recorded commit + patch, fresh sandbox,
// the run's own DB export re-imported (rehydrateEnv). All timeouts are
// operator settings (server/utils/settings.ts).

// Bring a run's env up before project-facing work: boot (or resume) its
// sandbox, mark it previewable. Idempotent.
export async function ensureEnvUp(runId: number): Promise<void> {
  await bootSandbox(runId)
  markUp(runId)
}

// Restart an idle-stopped env. The stopped sandbox keeps its filesystem
// (worktree mount, inner volumes, the imported DB), so booting it and running
// `ddev start` inside brings it back without re-running the workflow.
export async function rebootEnv(runId: number): Promise<void> {
  await bootSandbox(runId)
  await execInSandbox(runId, ['ddev', 'start'])
  markUp(runId)
}

// Restore an archived env exactly: recreate the worktree at the recorded
// commit, re-apply the uncommitted diff, boot a fresh sandbox and import the
// run's own DB export (falling back to the project dump for archives without
// one). Takes minutes, the price of archives costing MBs instead of GBs.
export async function rehydrateEnv(runId: number): Promise<void> {
  const run = getRun(runId)
  const project = run && getProject(run.projectId)
  if (!run || !project) throw new Error('Run or project not found')

  const token = await getInstallationToken(project.owner, project.name)
  const dir = await prepareRunCheckout(project, runId, token, () => {}, run.branch ?? project.defaultBranch, run.commitSha)

  // Re-apply the uncommitted changes saved at archive time, only onto a clean
  // worktree, so a retry after a half-done restore doesn't apply them twice.
  const patch = join(runArchiveDir(runId), 'worktree.patch')
  if (existsSync(patch)) {
    const { stdout: status } = await execa('git', ['-C', dir, 'status', '--porcelain'])
    if (!status.trim()) await execa('git', ['-C', dir, 'apply', patch])
  }
  writeDdevConfig(dir, project.envVars)

  await bootSandbox(runId)
  await execInSandbox(runId, ['ddev', 'start'])
  await importArchivedDb(runId, project)
  markUp(runId)
}

// The env is up and previewable now, even if later steps fail. Also resets
// the idle clock so the reaper doesn't stop what was just booted.
function markUp(runId: number): void {
  db.update(schema.runs)
    .set({ envState: 'up', previewLastSeen: new Date() })
    .where(eq(schema.runs.id, runId))
    .run()
}

// Stop a run's env: export its database into the run archive while the stack
// is still up, then stop the sandbox (which keeps its filesystem, so it can be
// rebooted quickly). Guarded: the export makes a stop take a while, and the
// reaper tick must not pile a second stop onto a run mid-export.
const stopping = new Set<number>()
export async function stopEnv(runId: number): Promise<void> {
  if (stopping.has(runId)) return
  stopping.add(runId)
  try {
    await exportRunDb(runId)
    await stopSandbox(runId)
    db.update(schema.runs).set({ envState: 'stopped' }).where(eq(schema.runs.id, runId)).run()
  }
  catch {
    // Leave envState as-is; the idle reaper retries on its next tick.
  }
  finally {
    stopping.delete(runId)
  }
}

// Export the env's CURRENT database into the run's archive. The DB can only
// change while the env is 'up', so exporting on the way down always captures
// the latest state, each stop overwrites the previous export. Best-effort: a
// run whose ddev never came up has nothing to export, and that must not block
// the stop.
async function exportRunDb(runId: number): Promise<void> {
  const inSandbox = '/tmp/knecht-db-export.sql.gz'
  try {
    await execInSandbox(runId, ['ddev', 'export-db', `--file=${inSandbox}`])
    mkdirSync(runArchiveDir(runId), { recursive: true })
    await copyOutOfSandbox(runId, inSandbox, join(runArchiveDir(runId), 'db.sql.gz'))
  }
  catch {
    // No (working) DB to export: restore falls back to the project dump.
  }
}

// Stop envs that have been idle (no preview access) longer than the configured
// timeout. This is the RAM guard: each 'up' env is a full nested Docker host.
export async function reapIdleEnvs(): Promise<void> {
  const { idleStopMinutes } = getSettings()
  const cutoff = new Date(Date.now() - idleStopMinutes * 60_000)
  const idle = db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.envState, 'up'), lt(schema.runs.previewLastSeen, cutoff)))
    .all()
  for (const { id } of idle) await stopEnv(id)
}

// Archive envs that have been 'stopped' (untouched) longer than the preview
// retention: snapshot what the teardown would lose (the worktree's HEAD + its
// uncommitted diff; the DB export was already taken at stop time), then
// delete the sandbox and worktree. 0 keeps stopped envs until the run is
// deleted.
export async function archiveStaleEnvs(): Promise<void> {
  const { previewRetentionDays } = getSettings()
  if (previewRetentionDays <= 0) return
  const cutoff = new Date(Date.now() - previewRetentionDays * 86_400_000)
  const stale = db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.envState, 'stopped'), lt(schema.runs.previewLastSeen, cutoff)))
    .all()
  for (const run of stale) {
    const project = getProject(run.projectId)
    if (!project) continue
    await snapshotWorktree(run.id)
    await teardownRun(run.id, projectCheckoutDir(project))
    db.update(schema.runs).set({ envState: 'archived' }).where(eq(schema.runs.id, run.id)).run()
  }
}

// Record what the teardown is about to delete from the worktree: its HEAD (the
// exact commit to restore later: commits the run itself made live on in the
// project's shared object store) and any uncommitted changes as a binary
// patch. `.ddev/config.knecht.yaml` is excluded via the base clone's
// info/exclude and regenerated on restore, so no secrets enter the patch.
async function snapshotWorktree(runId: number): Promise<void> {
  const dir = runWorktreeDir(runId)
  if (!existsSync(join(dir, '.git'))) return
  try {
    const { stdout: sha } = await execa('git', ['-C', dir, 'rev-parse', 'HEAD'])
    db.update(schema.runs).set({ commitSha: sha.trim() }).where(eq(schema.runs.id, runId)).run()
    await execa('git', ['-C', dir, 'add', '-A'])
    // Keep the final newline: execa strips it by default, and `git apply`
    // rejects a patch whose last hunk line lost it ("corrupt patch").
    const { stdout: patch } = await execa('git', ['-C', dir, 'diff', '--cached', '--binary'], { maxBuffer: 256 * 1024 * 1024, stripFinalNewline: false })
    if (patch.trim()) {
      mkdirSync(runArchiveDir(runId), { recursive: true })
      writeFileSync(join(runArchiveDir(runId), 'worktree.patch'), patch)
    }
  }
  catch {
    // Best-effort: the restore then falls back to the branch tip, no patch.
  }
}

// Delete archives untouched longer than the archive retention; after this
// only re-running the workflow gets a fresh environment. 0 keeps archives
// until the run is deleted.
export async function reapExpiredArchives(): Promise<void> {
  const { archiveRetentionDays } = getSettings()
  if (archiveRetentionDays <= 0) return
  const cutoff = new Date(Date.now() - archiveRetentionDays * 86_400_000)
  const expired = db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.envState, 'archived'), lt(schema.runs.previewLastSeen, cutoff)))
    .all()
  for (const { id } of expired) {
    rmSync(runArchiveDir(id), { recursive: true, force: true })
    db.update(schema.runs).set({ envState: 'down' }).where(eq(schema.runs.id, id)).run()
  }
}

// Import the run's archived DB export into a freshly restored env; archives
// without one (the export never succeeded) fall back to the project's dump.
async function importArchivedDb(runId: number, project: Project): Promise<void> {
  const archived = join(runArchiveDir(runId), 'db.sql.gz')
  const fallback = project.dbDumpPath && join(projectDumpDir(project.id), basename(project.dbDumpPath))
  const file = existsSync(archived) ? archived : fallback && existsSync(fallback) ? fallback : null
  if (!file) return
  const inSandbox = `/tmp/${basename(file)}`
  await copyIntoSandbox(runId, file, inSandbox)
  await execInSandbox(runId, ['ddev', 'import-db', `--file=${inSandbox}`])
}

// Fully tear down a run's isolated environment: remove its sandbox container
// (the whole nested world of inner containers, volumes, imported DB lives in
// its filesystem and goes with it) and remove its git worktree. Both steps are
// best-effort so a half-gone env still gets cleaned up. `baseDir` is the
// project's base clone the worktree hangs off.
export async function teardownRun(runId: number, baseDir: string): Promise<void> {
  await removeSandbox(runId)
  try {
    await execa('git', ['-C', baseDir, 'worktree', 'remove', '--force', runWorktreeDir(runId)])
  }
  catch {
    // Worktree already gone.
  }
}
