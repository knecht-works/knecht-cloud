import { stopEnv } from '../../../daemon/envs'
import { requireSession } from '../../../utils/entities'
import { sessionHasActiveWork } from '../../../utils/sessions'
import { withSessionEnv } from '../../../utils/run-view'

// POST /api/runs/:id/stop → step the session's environment down NOW instead
// of waiting for the idle reaper: the database is exported on the way down,
// containers are removed, volumes and checkout are kept, so a reboot is
// quick. Together with archive/reboot this lets an operator walk an env
// through every lifecycle state on demand.
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
