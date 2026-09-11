import { and, asc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { startRun } from './runner'
import { startFollowup } from './followups'
import { getSettings } from '../utils/settings'

// Started but maybe not yet 'running': guards against double-starting across ticks.
const active = new Map<number, number>()
const activeFollowups = new Map<number, number>()

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

export function hasRunningWork(): boolean {
  return busySessions().size > 0
}

export function dispatchRuns(): void {
  // A mention run is executed by its follow-up and must not block it below.
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
      dispatchRuns()
    })
    capacity--
  }

  // A mention's starter run must boot the env before the mention prompt runs.
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
