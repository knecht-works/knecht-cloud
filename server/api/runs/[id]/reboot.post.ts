import { reviveEnv } from '../../../daemon/envs'
import { requireSession } from '../../../utils/entities'
import { withSessionEnv } from '../../../utils/run-view'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (session.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'No environment left. Run the workflow again.' })
  }

  await reviveEnv(session.id)

  return withSessionEnv(requireRun(id))
})
