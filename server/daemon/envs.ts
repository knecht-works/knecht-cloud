import { and, asc, eq, lt, ne } from 'drizzle-orm'
import { db, schema } from '../db'
import { getSettings } from '../utils/settings'
import { projectCheckoutDir } from '../utils/storage'
import { teardownRun } from './ddev'
import { stopSandbox } from './sandbox'

// Lifecycle of the per-run sandboxes. Each one is a full nested Docker host
// (dockerd + ddev stack), so CPU/RAM/disk pile up fast without bounds. These
// helpers keep the count bounded; the limits are operator settings
// (server/utils/settings.ts).

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
