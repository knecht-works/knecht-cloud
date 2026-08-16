import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../../../db'
import { cancelFollowup } from '../../../../daemon/followups'

// POST /api/runs/:id/followups/cancel → stop the session's active follow-up. The
// row flips to failed/'Cancelled' immediately (the composer unlocks without
// waiting on the executor), then the in-process executor is aborted: it kills
// the in-flight sandbox command and unwinds. A queued follow-up is simply
// dequeued (the executor's claim finds no queued row).
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)

  const cancelled = db
    .update(schema.followups)
    .set({ status: 'failed', error: 'Cancelled', finishedAt: new Date() })
    .where(and(
      eq(schema.followups.sessionId, run.sessionId),
      inArray(schema.followups.status, ['queued', 'running']),
    ))
    .run()
  if (!cancelled.changes) {
    throw createError({ statusCode: 409, statusMessage: 'No follow-up is running' })
  }

  // A cancelled mention follow-up takes its anchor run with it: that run row
  // exists only as the mention's face in the run list, and nothing else would
  // ever move it out of queued/running (daemon/followups.ts drives it).
  db.update(schema.runs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(
      eq(schema.runs.sessionId, run.sessionId),
      eq(schema.runs.kind, 'mention'),
      inArray(schema.runs.status, ['queued', 'running']),
    ))
    .run()

  cancelFollowup(run.sessionId)
  return { cancelled: true }
})
