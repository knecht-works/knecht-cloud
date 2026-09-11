import { archiveEnv } from '../../../daemon/envs'
import { requireSession } from '../../../utils/entities'
import { sessionHasActiveWork } from '../../../utils/sessions'
import { withRunSessionEnv } from '../../../utils/run-view'

// The stop step is not skipped: stopping is what exports the database the
// archive needs.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  // Queued work is about to revive this env; tearing it down races that.
  if (sessionHasActiveWork(session.id)) {
    throw createError({ statusCode: 409, statusMessage: 'The session still has work pending for this environment.' })
  }
  if (session.envState !== 'stopped') {
    throw createError({
      statusCode: 409,
      statusMessage: session.envState === 'up'
        ? 'Stop the environment first, that is what exports its database.'
        : 'Only a stopped environment can be archived.',
    })
  }
  await archiveEnv(session.id)
  return withRunSessionEnv(requireRun(id))
})
