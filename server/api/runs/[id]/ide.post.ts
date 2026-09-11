import { ideMountMissing, ideStaged, startRunIde } from '../../../daemon/ide'
import { requireSession } from '../../../utils/entities'
import { rebootEnv } from '../../../daemon/envs'
import { sessionHasActiveWork } from '../../../utils/sessions'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (session.envState !== 'up') {
    throw createError({ statusCode: 409, statusMessage: 'Boot or reboot the environment first.' })
  }

  // Envs booted before the IDE download finished lack the mount. Not while
  // work is executing: recreating the web container would kill it.
  if (ideStaged() && await ideMountMissing(session.id)) {
    if (sessionHasActiveWork(session.id)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'The environment needs a quick restart to add the IDE. Wait for the current run or follow-up to finish, then try again.',
      })
    }
    await rebootEnv(session.id)
  }

  await startRunIde(session.id)

  const url = getRequestURL(event)
  return { url: `${url.protocol}//${previewHostname(session.id, url.host, 'ide')}` }
})
