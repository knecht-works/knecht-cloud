import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { cancelRun } from '../../../daemon/runner'

// POST /api/runs/:id/cancel → stop a live run. The row flips to 'cancelled'
// immediately (the UI settles without waiting on the runner), then the
// in-process runner is aborted: it kills the in-flight sandbox command and
// unwinds at the next step boundary. The env is left as-is, so the run stays
// previewable and retryable. Cancelling a queued run just dequeues it.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireRun(id)

  const cancelled = db
    .update(schema.runs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(eq(schema.runs.id, id), inArray(schema.runs.status, ['queued', 'running'])))
    .run()
  if (!cancelled.changes) {
    throw createError({ statusCode: 409, statusMessage: 'Run already finished' })
  }

  cancelRun(id)
  return getRun(id)
})
