import { envTransition } from '../../daemon/envs'
import { getRunView } from '../../stores/runs'
import { withSessionEnv } from '../../utils/run-view'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)

  const run = getRunView(id)

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }

  return { ...withSessionEnv(run), envTransition: envTransition(run.sessionId) }
})
