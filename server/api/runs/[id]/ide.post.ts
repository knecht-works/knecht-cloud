import { ideMountMissing, ideStaged, startRunIde } from '#server/daemon/ide'
import { rebootEnv, reviveEnv } from '#server/daemon/envs'
import { sessionHasActiveWork } from '#server/utils/sessions'
import { requireSession } from '#server/stores/sessions'
import { requireRun } from '#server/stores/runs'
import { defineEventHandler, createError, getRequestURL } from 'h3'
import { requireIntParam } from '#server/utils/http'
import { previewHostname } from '#shared/utils/preview-host'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (session.envState !== 'up') {
    throw createError({ statusCode: 409, statusMessage: 'Boot or reboot the environment first.' })
  }

  await reviveEnv(session.id).catch((e: Error) => {
    throw createError({ statusCode: 409, statusMessage: e.message })
  })

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
