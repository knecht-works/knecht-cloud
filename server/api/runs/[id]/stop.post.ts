import { stopEnv } from '../../../daemon/envs'

// POST /api/runs/:id/stop → step the run's environment down NOW instead of
// waiting for the idle reaper: the database is exported on the way down,
// containers are removed, volumes and checkout are kept, so a reboot is
// quick. Together with archive/reboot this lets an operator walk an env
// through every lifecycle state on demand.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  if (run.status === 'queued' || run.status === 'running') {
    throw createError({ statusCode: 409, statusMessage: 'The run is still executing; cancel it first.' })
  }
  if (run.envState !== 'up') {
    throw createError({ statusCode: 409, statusMessage: 'Only a running environment can be stopped.' })
  }
  await stopEnv(id)
  return getRun(id)
})
