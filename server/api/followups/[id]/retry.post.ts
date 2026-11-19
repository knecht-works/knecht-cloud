import { startFollowup } from '#server/daemon/followups'
import { dispatchRuns } from '#server/daemon/dispatcher'
import { sessionHasActiveWork } from '#server/utils/sessions'
import { emitLive } from '#server/utils/live'
import { followupView } from '#server/utils/transcript'
import { requireSession } from '#server/stores/sessions'
import { requireRun } from '#server/stores/runs'
import { getFollowup, requeueFollowup } from '#server/stores/followups'
import { deleteAgentItems } from '#server/stores/agent-items'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

// The failed turn is reused as is (prompt, model, attachments): its transcript starts over.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const followup = getFollowup(id)
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

  deleteAgentItems({ followupIds: [id] })
  requeueFollowup(id)
  const view = followupView(id)!
  emitLive({ type: 'followup-reset', sessionId: session.id, followup: view })

  if (session.envState === 'up' && !busy) void startFollowup(id)
  else dispatchRuns()

  return view
})
