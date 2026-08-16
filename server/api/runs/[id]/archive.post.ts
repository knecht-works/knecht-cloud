import { archiveEnv } from '../../../daemon/envs'
import { requireSession } from '../../../utils/entities'
import { sessionHasActiveWork } from '../../../utils/sessions'
import { withSessionEnv } from '../../../utils/run-view'

// POST /api/runs/:id/archive → archive the session's stopped environment NOW
// instead of waiting for the retention reaper: the code state (and the
// agent's conversation) is snapshotted, the heavy sandbox and checkout are
// deleted, and a restore stays possible (reboot endpoint). The stop step is
// not skipped: stopping is what exports the database the archive needs.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  // Queued work is about to revive this env; tearing it down now races that
  // reboot.
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
  return withSessionEnv(requireRun(id))
})
