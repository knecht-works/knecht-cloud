import { reviveEnv } from '#server/daemon/envs'
import { OperationCancelled, SessionGone } from '#server/daemon/session-env'
import { withRunSessionEnv } from '#server/utils/run-view'
import { requireSession } from '#server/stores/sessions'
import { requireRun } from '#server/stores/runs'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (session.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'No environment left. Run the workflow again.' })
  }

  try {
    await reviveEnv(session.id)
  }
  catch (e) {
    // Someone cancelled or deleted it on purpose: not a failure to report.
    if (e instanceof SessionGone) return null
    if (!(e instanceof OperationCancelled)) throw e
  }

  return withRunSessionEnv(requireRun(id))
})
