import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { startRun } from './runner'
import { startFollowup } from './followups'
import { getSettings } from '../utils/settings'

// The run dispatcher (workflow-engine-plan.md D6): the ONLY place runs start.
// Creating a run (POST /api/runs, trigger fires) inserts a 'queued' row and
// pokes `dispatchRuns()`; a slow safety interval (server/plugins/dispatcher.ts)
// catches anything a poke missed. Queued runs claim oldest-first under the
// instance-wide concurrency limit (settings.maxConcurrentRuns: each run boots
// a full sandbox, so the limit is the CPU/RAM guard). Queuing is crash-safe:
// 'queued' rows survive a restart (runs-recover only fails 'running' rows) and
// start when the dispatcher comes back up.
//
// Follow-ups share the same slots: a queued follow-up revives its run's
// stopped/archived env, which re-occupies the RAM of a running env. (A
// follow-up on an env that is already 'up' skips the queue entirely: the API
// starts it directly, its RAM is already spent.)

// Runs/follow-ups this process has started that may not have flipped to
// 'running' yet: the guard against double-starting across ticks.
const active = new Set<number>()
const activeFollowups = new Set<number>()

export function dispatchRuns(): void {
  // The queue is tiny by construction (a single-instance tool); fetching all
  // queued rows keeps the claim logic trivial.
  const queued = db
    .select({
      run: { id: schema.runs.id },
      project: schema.projects,
    })
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .where(eq(schema.runs.status, 'queued'))
    .orderBy(asc(schema.runs.id))
    .all()
    .filter(({ run }) => !active.has(run.id))

  let capacity = Math.max(1, getSettings().maxConcurrentRuns) - active.size - activeFollowups.size
  for (const { run, project } of queued.slice(0, Math.max(0, capacity))) {
    active.add(run.id)
    startRun(run.id, project).finally(() => {
      active.delete(run.id)
      // A slot just freed, pull the next queued run in immediately.
      dispatchRuns()
    })
    capacity--
  }

  // Runs first (they are the primary work), follow-ups fill what's left.
  const queuedFollowups = db
    .select({ id: schema.followups.id })
    .from(schema.followups)
    .where(eq(schema.followups.status, 'queued'))
    .orderBy(asc(schema.followups.id))
    .all()
    .filter(({ id }) => !activeFollowups.has(id))
  for (const { id } of queuedFollowups.slice(0, Math.max(0, capacity))) {
    activeFollowups.add(id)
    startFollowup(id).finally(() => {
      activeFollowups.delete(id)
      dispatchRuns()
    })
    capacity--
  }
}
