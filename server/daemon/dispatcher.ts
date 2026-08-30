import { and, asc, eq, inArray } from 'drizzle-orm'
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
// Sessions serialize their work (ADR 0006): all runs and follow-ups of a
// session share one checkout, env and conversation, so at most one of them
// executes at a time. Queued work for a busy session is skipped this tick and
// picked up (FIFO) when the session frees.
//
// Follow-ups share the same slots: a queued follow-up revives its session's
// stopped/archived env, which re-occupies the RAM of a running env. (A
// follow-up on an env that is already 'up' skips the queue entirely: the API
// starts it directly, its RAM is already spent.)

// Runs/follow-ups this process has started that may not have flipped to
// 'running' yet (value: their session), the guard against double-starting
// across ticks and the in-flight half of the busy-session set.
const active = new Map<number, number>()
const activeFollowups = new Map<number, number>()

// Sessions with work executing right now: rows already 'running' in the DB
// plus everything this process just claimed.
function busySessions(): Set<number> {
  const busy = new Set<number>([...active.values(), ...activeFollowups.values()])
  for (const r of db
    .select({ sessionId: schema.runs.sessionId })
    .from(schema.runs)
    .where(eq(schema.runs.status, 'running'))
    .all()) {
    busy.add(r.sessionId)
  }
  for (const f of db
    .select({ sessionId: schema.followups.sessionId })
    .from(schema.followups)
    .where(inArray(schema.followups.status, ['running']))
    .all()) {
    busy.add(f.sessionId)
  }
  return busy
}

// Whether any run or follow-up is executing right now (including work this
// process just claimed but that hasn't flipped to 'running' yet). Auto-update
// (server/plugins/auto-update.ts) uses this: restarting the container fails
// running work, while 'queued' rows survive and start after the update.
export function hasRunningWork(): boolean {
  return busySessions().size > 0
}

export function dispatchRuns(): void {
  // The queue is tiny by construction (a single-instance tool); fetching all
  // queued rows keeps the claim logic trivial. Mention runs are excluded on
  // both counts: the runner never executes them (their follow-up does, and
  // it drives the run row's status), and a queued mention run must not block
  // its own follow-up in the loop below.
  const queued = db
    .select({
      run: { id: schema.runs.id, sessionId: schema.runs.sessionId },
      project: schema.projects,
    })
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .where(and(eq(schema.runs.status, 'queued'), eq(schema.runs.kind, 'workflow')))
    .orderBy(asc(schema.runs.id))
    .all()
    .filter(({ run }) => !active.has(run.id))

  const busy = busySessions()
  let capacity = Math.max(1, getSettings().maxConcurrentRuns) - active.size - activeFollowups.size
  for (const { run, project } of queued) {
    if (capacity <= 0) break
    if (busy.has(run.sessionId)) continue
    busy.add(run.sessionId)
    active.set(run.id, run.sessionId)
    startRun(run.id, project).finally(() => {
      active.delete(run.id)
      // A slot just freed, pull the next queued run in immediately.
      dispatchRuns()
    })
    capacity--
  }

  // Runs first (they are the primary work), follow-ups fill what's left. A
  // session with a run still WAITING for a slot also blocks its follow-ups:
  // a mention's starter run must boot the env before the mention prompt runs.
  for (const { run } of queued) {
    if (!active.has(run.id)) busy.add(run.sessionId)
  }
  const queuedFollowups = db
    .select({ id: schema.followups.id, sessionId: schema.followups.sessionId })
    .from(schema.followups)
    .where(eq(schema.followups.status, 'queued'))
    .orderBy(asc(schema.followups.id))
    .all()
    .filter(f => !activeFollowups.has(f.id))
  for (const { id, sessionId } of queuedFollowups) {
    if (capacity <= 0) break
    if (busy.has(sessionId)) continue
    busy.add(sessionId)
    activeFollowups.set(id, sessionId)
    startFollowup(id).finally(() => {
      activeFollowups.delete(id)
      dispatchRuns()
    })
    capacity--
  }
}
