import { archiveEnv } from '../../../daemon/envs'

// POST /api/runs/:id/archive → archive the run's stopped environment NOW
// instead of waiting for the retention reaper: the code state is snapshotted,
// the heavy sandbox and checkout are deleted, and a restore stays possible
// (reboot endpoint). The stop step is not skipped: stopping is what exports
// the database the archive needs.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  if (run.envState !== 'stopped') {
    throw createError({
      statusCode: 409,
      statusMessage: run.envState === 'up'
        ? 'Stop the environment first, that is what exports its database.'
        : 'Only a stopped environment can be archived.',
    })
  }
  await archiveEnv(id)
  return getRun(id)
})
