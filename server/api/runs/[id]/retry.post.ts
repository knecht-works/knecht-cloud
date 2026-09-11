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

// Resuming past completed steps needs the session's checkout (their file state).
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)

  if (run.status !== 'failed' && run.status !== 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'Only failed or cancelled runs can be retried' })
  }
  if (run.kind === 'mention') {
    throw createError({ statusCode: 409, statusMessage: 'A mention run cannot be retried. Mention Knecht on the thread again instead.' })
  }
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
