import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { startFollowup } from '../../../daemon/followups'
import { dispatchRuns } from '../../../daemon/dispatcher'
import { requireSession } from '../../../utils/entities'
import { sessionHasActiveWork } from '../../../utils/sessions'
import { emitLive } from '../../../utils/live'
import { followupView } from '../../../utils/transcript'

// The failed turn is reused as is (prompt, model, attachments): its transcript starts over.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const followup = db.select().from(schema.followups).where(eq(schema.followups.id, id)).get()
  if (!followup) throw createError({ statusCode: 404, statusMessage: 'Follow-up not found' })
  if (followup.status !== 'failed') throw createError({ statusCode: 409, statusMessage: 'Only a failed turn can be retried' })

  const run = requireRun(followup.runId)
  const session = requireSession(followup.sessionId)
  if (run.status === 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'A cancelled run accepts no follow-ups. Retry it first.' })
  }
  const pending = run.status === 'queued' || run.status === 'running'
  if (!pending && session.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'The session\'s environment is gone. Run the workflow again.' })
  }
  const busy = pending || sessionHasActiveWork(session.id)

  db.delete(schema.agentItems).where(eq(schema.agentItems.followupId, id)).run()
  db.update(schema.followups)
    .set({ status: 'queued', error: null, startedAt: null, finishedAt: null })
    .where(eq(schema.followups.id, id))
    .run()
  const view = followupView(id)!
  emitLive({ type: 'followup-reset', sessionId: session.id, followup: view })

  if (session.envState === 'up' && !busy) void startFollowup(id)
  else dispatchRuns()

  return view
})
