import { execa } from 'execa'
import { and, asc, eq, lt, ne } from 'drizzle-orm'
import { db, schema } from '../db'
import { getSettings } from '../utils/settings'
import { projectCheckoutDir, runWorktreeDir } from '../utils/storage'
import { bootSandbox, execInSandbox, removeSandbox, stopSandbox } from './sandbox'

// Lifecycle of the per-run environments — the ONE place that moves envState.
// Each env is a full nested Docker host (dockerd + ddev stack), so CPU/RAM/
// disk pile up fast without bounds. The limits are operator settings
// (server/utils/settings.ts).

// Bring a run's env up before project-facing work: bound the fleet, boot (or
// resume) its sandbox, mark it previewable. Idempotent.
export async function ensureEnvUp(runId: number): Promise<void> {
  await enforceEnvCap(runId)
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

// The env is up and previewable now, even if later steps fail. Also resets
// the idle clock so the reaper doesn't stop what was just booted.
function markUp(runId: number): void {
  db.update(schema.runs)
    .set({ envState: 'up', previewLastSeen: new Date() })
    .where(eq(schema.runs.id, runId))
    .run()
}

// Stop a run's env: stopping the sandbox shuts the whole inner world down
// cleanly while keeping its filesystem (inner volumes, imported DB), so it can
// be rebooted quickly.
export async function stopEnv(runId: number): Promise<void> {
  try {
    await stopSandbox(runId)
    db.update(schema.runs).set({ envState: 'stopped' }).where(eq(schema.runs.id, runId)).run()
  }
  catch {
    // Leave envState as-is; the idle reaper retries on its next tick.
  }
}

// Make room before booting a new env: stop the least-recently-previewed 'up'
// envs until fewer than the cap remain (leaving a slot for the one about to
// boot). This is what keeps the host from drowning in nested Docker hosts.
export async function enforceEnvCap(exceptRunId: number): Promise<void> {
  const cap = getSettings().maxConcurrentEnvs
  if (cap <= 0) return
  const up = db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.envState, 'up'), ne(schema.runs.id, exceptRunId)))
    .orderBy(asc(schema.runs.previewLastSeen)) // nulls (never previewed) first
    .all()

  const overflow = up.length - (cap - 1)
  for (const { id } of up.slice(0, Math.max(0, overflow))) {
    await stopEnv(id)
  }
}

// Stop envs that have been idle (no preview access) longer than the configured
// timeout. Keeps the sandbox filesystem — a reboot is quick.
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

// Fully delete envs that have been 'stopped' (untouched) longer than the
// teardown timeout, reclaiming their sandbox + worktree. 0 disables it.
export async function reapStoppedEnvs(): Promise<void> {
  const { teardownStoppedMinutes } = getSettings()
  if (teardownStoppedMinutes <= 0) return
  const cutoff = new Date(Date.now() - teardownStoppedMinutes * 60_000)
  const stale = db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.envState, 'stopped'), lt(schema.runs.previewLastSeen, cutoff)))
    .all()
  for (const run of stale) {
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, run.projectId)).get()
    if (project) await teardownRun(run.id, projectCheckoutDir(project))
    db.update(schema.runs).set({ envState: 'down' }).where(eq(schema.runs.id, run.id)).run()
  }
}

// Fully tear down a run's isolated environment: remove its sandbox container
// (the whole nested world — inner containers, volumes, imported DB — lives in
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
