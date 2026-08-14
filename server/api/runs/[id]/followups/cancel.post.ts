import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../../../db'
import { cancelFollowup } from '../../../../daemon/followups'

// POST /api/runs/:id/followups/cancel → stop the run's active follow-up. The
// row flips to failed/'Cancelled' immediately (the composer unlocks without
// waiting on the executor), then the in-process executor is aborted: it kills
// the in-flight sandbox command and unwinds. A queued follow-up is simply
// dequeued (the executor's claim finds no queued row).
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireRun(id)

  const cancelled = db
    .update(schema.followups)
    .set({ status: 'failed', error: 'Cancelled', finishedAt: new Date() })
    .where(and(
      eq(schema.followups.runId, id),
      inArray(schema.followups.status, ['queued', 'running']),
    ))
    .run()
  if (!cancelled.changes) {
    throw createError({ statusCode: 409, statusMessage: 'No follow-up is running' })
  }

  cancelFollowup(id)
  return { cancelled: true }
})
