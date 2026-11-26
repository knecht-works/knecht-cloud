import { stopEnv } from '#server/daemon/envs'
import { sessionHasActiveWork } from '#server/utils/sessions'
import { withRunSessionEnv } from '#server/utils/run-view'
import { requireSession } from '#server/stores/sessions'
import { requireRun } from '#server/stores/runs'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (sessionHasActiveWork(session.id)) {
    throw createError({ statusCode: 409, statusMessage: 'The session is still executing work; wait for it or cancel it first.' })
  }
  if (session.envState !== 'up') {
    throw createError({ statusCode: 409, statusMessage: 'Only a running environment can be stopped.' })
  }
  await stopEnv(session.id, { byHand: true })
  return withRunSessionEnv(requireRun(id))
})
