import { stopEnv } from '../../../daemon/envs'
import { requireSession } from '../../../utils/entities'
import { sessionHasActiveWork } from '../../../utils/sessions'
import { withSessionEnv } from '../../../utils/run-view'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (sessionHasActiveWork(session.id)) {
    throw createError({ statusCode: 409, statusMessage: 'The session is still executing work; wait for it or cancel it first.' })
  }
  if (session.envState !== 'up') {
    throw createError({ statusCode: 409, statusMessage: 'Only a running environment can be stopped.' })
  }
  await stopEnv(session.id)
  return withSessionEnv(requireRun(id))
})
