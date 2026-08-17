import { cancelFollowupWork } from '../../../../daemon/followups'

// POST /api/runs/:id/followups/cancel → stop the session's active follow-up. The
// row flips to failed/'Cancelled' immediately (the composer unlocks without
// waiting on the executor), any mention anchor runs flip with it, then the
// in-process executor is aborted: it kills the in-flight sandbox command and
// unwinds. A queued follow-up is simply dequeued (the executor's claim finds
// no queued row). daemon/followups.ts (cancelFollowupWork) owns the how.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)

  const cancelled = cancelFollowupWork(run.sessionId)
  if (!cancelled) {
    throw createError({ statusCode: 409, statusMessage: 'No follow-up is running' })
  }
  return { cancelled: true }
})
