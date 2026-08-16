import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { resumePoint } from '../../../daemon/runner'
import { requireSession } from '../../../utils/entities'
import { dispatchRuns } from '../../../daemon/dispatcher'
import { hasActiveFollowup } from '../../../daemon/followups'
import { sessionCheckoutDir } from '../../../utils/storage'
import { withSessionEnv } from '../../../utils/run-view'

// POST /api/runs/:id/retry → re-queue a failed (or cancelled) run without
// re-executing what already completed: the runner resumes from the step that
// stopped it, replaying the completed steps' outputs (daemon/runner.ts).
// Resuming past a completed prefix needs the session's checkout (the
// completed steps' file state); a run that failed before its first step
// re-executes fully and can do so on a fresh checkout.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)

  if (run.status !== 'failed' && run.status !== 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'Only failed or cancelled runs can be retried' })
  }
  // A retry and a follow-up would share the session's sandbox; one at a time
  // (the dispatcher serializes anyway, this just gives a clear message).
  if (hasActiveFollowup(session.id)) {
    throw createError({ statusCode: 409, statusMessage: 'A follow-up is running in this session. Wait for it to finish.' })
  }
  if (!run.steps) {
    throw createError({ statusCode: 409, statusMessage: 'This run predates step snapshots and cannot resume. Run the workflow again.' })
  }
  if (resumePoint(id).fromIndex > 0) {
    if (session.envState === 'archived') {
      throw createError({ statusCode: 409, statusMessage: 'The environment is archived. Restore it first, then retry.' })
    }
    if (!existsSync(join(sessionCheckoutDir(session.id), '.git'))) {
      throw createError({ statusCode: 409, statusMessage: 'The session\'s checkout is gone, so it cannot resume. Run the workflow again.' })
    }
  }

  db.update(schema.runs)
    .set({ status: 'queued', finishedAt: null })
    .where(eq(schema.runs.id, id))
    .run()
  dispatchRuns()

  return withSessionEnv(requireRun(id))
})
