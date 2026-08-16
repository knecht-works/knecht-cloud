import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { cancelFollowup } from '../../../daemon/followups'
import { cancelRun } from '../../../daemon/runner'
import { withSessionEnv } from '../../../utils/run-view'

// POST /api/runs/:id/cancel → stop a live run. The row flips to 'cancelled'
// immediately (the UI settles without waiting on the runner), then the
// in-process runner is aborted: it kills the in-flight sandbox command and
// unwinds at the next step boundary. The env is left as-is, so the run stays
// previewable and retryable. Cancelling a queued run just dequeues it.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)

  const cancelled = db
    .update(schema.runs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(eq(schema.runs.id, id), inArray(schema.runs.status, ['queued', 'running'])))
    .run()
  if (!cancelled.changes) {
    throw createError({ statusCode: 409, statusMessage: 'Run already finished' })
  }

  // A mention run is driven by its follow-up, not the runner: stopping it
  // means stopping that follow-up (dequeue if queued, abort if executing).
  if (run.kind === 'mention') {
    db.update(schema.followups)
      .set({ status: 'failed', error: 'Cancelled', finishedAt: new Date() })
      .where(and(
        eq(schema.followups.runId, id),
        inArray(schema.followups.status, ['queued', 'running']),
      ))
      .run()
    cancelFollowup(run.sessionId)
  }
  else {
    cancelRun(id)
  }
  return withSessionEnv(requireRun(id))
})
