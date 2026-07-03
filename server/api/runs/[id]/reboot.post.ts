import { rebootEnv, rehydrateEnv } from '../../../daemon/envs'

// POST /api/runs/:id/reboot → bring a run's environment back: a stopped one
// reboots in seconds, an archived one is restored exactly from its archive
// (takes minutes). daemon/envs.ts owns the how. Returns the refreshed run row.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  if (run.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'No environment left. Run the workflow again.' })
  }

  if (run.envState === 'archived') {
    await rehydrateEnv(id)
  }
  else {
    await rebootEnv(id)
  }

  return getRun(id)
})
