import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { cancelFollowupWork } from '../../../daemon/followups'
import { cancelRun } from '../../../daemon/runner'
import { withRunSessionEnv } from '../../../utils/run-view'

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

  if (run.kind === 'mention') {
    cancelFollowupWork(run.sessionId, id)
  }
  else {
    cancelRun(id)
  }
  return withRunSessionEnv(requireRun(id))
})
