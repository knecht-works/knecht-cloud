import { reviveEnv } from '../../../daemon/envs'
import { withRunSessionEnv } from '../../../utils/run-view'
import { requireSession } from '../../../stores/sessions'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (session.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'No environment left. Run the workflow again.' })
  }

  await reviveEnv(session.id)

  return withRunSessionEnv(requireRun(id))
})
