import { startFollowup } from '../../../daemon/followups'
import { dispatchRuns } from '../../../daemon/dispatcher'
import { sessionHasActiveWork } from '../../../utils/sessions'
import { emitLive } from '../../../utils/live'
import { followupView } from '../../../utils/transcript'
import { requireSession } from '../../../stores/sessions'
import { requireRun } from '../../../stores/runs'
import { getFollowup, requeueFollowup } from '../../../stores/followups'
import { deleteAgentItems } from '../../../stores/agent-items'

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
