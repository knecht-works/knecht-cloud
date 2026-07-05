import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { startRun } from '../daemon/runner'
import { getSettings } from '../utils/settings'

// The run dispatcher (workflow-engine-plan.md D6): the ONLY place runs start.
// Creating a run (POST /api/runs, trigger fires) just inserts a 'queued' row;
// this loop claims queued runs oldest-first and executes them under the
// instance-wide concurrency limit (settings.maxConcurrentRuns — each run boots
// a full sandbox, so the limit is the CPU/RAM guard). Queuing is crash-safe:
// 'queued' rows survive a restart (runs-recover only fails 'running' rows) and
// start when the dispatcher comes back up.
export default defineNitroPlugin(() => {
  // Runs this process has started that may not have flipped to 'running' yet —
  // the guard against double-starting a run across ticks.
  const active = new Set<number>()

  const tick = () => {
    const capacity = Math.max(1, getSettings().maxConcurrentRuns) - active.size
    if (capacity <= 0) return

    const queued = db
      .select({ id: schema.runs.id, projectId: schema.runs.projectId })
      .from(schema.runs)
      .where(eq(schema.runs.status, 'queued'))
      .orderBy(asc(schema.runs.id))
      .limit(capacity + active.size)
      .all()
      .filter(run => !active.has(run.id))
      .slice(0, capacity)

    for (const run of queued) {
      const project = db.select().from(schema.projects).where(eq(schema.projects.id, run.projectId)).get()
      if (!project) {
        // Should be unreachable (project deletes cascade to runs) — but a run
        // must never sit queued forever.
        db.update(schema.runs)
          .set({ status: 'failed', finishedAt: new Date(), log: 'Project no longer exists\n' })
          .where(eq(schema.runs.id, run.id))
          .run()
        continue
      }
      active.add(run.id)
      startRun(run.id, project).finally(() => active.delete(run.id))
    }
  }

  // Interval-only (like the scheduler): the first tick lands after boot-time
  // migrations/recovery have run.
  setInterval(tick, 2_000)
})
