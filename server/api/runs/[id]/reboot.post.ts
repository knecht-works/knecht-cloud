import { rebootEnv, rehydrateEnv } from '../../../daemon/envs'
import { requireSession } from '../../../utils/entities'
import { withSessionEnv } from '../../../utils/run-view'

// POST /api/runs/:id/reboot → bring the run's session environment back: a
// stopped one reboots in seconds, an archived one is restored exactly from
// its archive (takes minutes). daemon/envs.ts owns the how. Returns the
// refreshed run payload.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (session.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'No environment left. Run the workflow again.' })
  }

  if (session.envState === 'archived') {
    await rehydrateEnv(session.id)
  }
  else {
    await rebootEnv(session.id)
  }

  return withSessionEnv(requireRun(id))
})
