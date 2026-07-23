import { ideMountMissing, ideStaged, startRunIde } from '../../../daemon/ide'
import { rebootEnv } from '../../../daemon/envs'

// POST /api/runs/:id/ide → make sure the run's web IDE is up and return its
// origin (`ide--<id>.preview.<host>`). The client opens it in a new tab; auth
// happens at the IDE origin itself (ide-proxy.ts, same session cookie).
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  if (run.envState !== 'up') {
    throw createError({ statusCode: 409, statusMessage: 'Boot or reboot the environment first.' })
  }

  // Envs booted before the IDE existed (or before its download finished) lack
  // the mount. Heal in place: rebootEnv refreshes the compose override and
  // `ddev start` reconciles the container. Not while a workflow is executing:
  // recreating the web container would kill the running step.
  if (ideStaged() && await ideMountMissing(id)) {
    if (run.status === 'queued' || run.status === 'running') {
      throw createError({
        statusCode: 409,
        statusMessage: 'The environment needs a quick restart to add the IDE. Wait for the run to finish, then try again.',
      })
    }
    await rebootEnv(id)
  }

  await startRunIde(id)

  const url = getRequestURL(event)
  return { url: `${url.protocol}//${previewHostname(id, url.host, 'ide')}` }
})
