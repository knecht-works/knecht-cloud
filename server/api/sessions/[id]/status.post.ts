import { z } from 'zod'
import { requireSession } from '#server/stores/sessions'
import { sessionHasActiveWork, setObjectlessSessionStatus } from '#server/utils/sessions'
import { stopEnv } from '#server/daemon/envs'
import { requireIntParam, zodBadRequest } from '#server/utils/http'
import { defineEventHandler, readBody, createError } from 'h3'

const bodySchema = z.object({ status: z.enum(['open', 'closed']) })

export default defineEventHandler(async (event) => {
  const session = requireSession(requireIntParam(event))
  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) zodBadRequest(body.error, 'Invalid session status')
  if (!setObjectlessSessionStatus(session, body.data.status)) {
    throw createError({ statusCode: 409, statusMessage: 'This session follows its ticket or pull request' })
  }
  if (body.data.status === 'closed' && session.envState === 'up' && !sessionHasActiveWork(session.id)) {
    void stopEnv(session.id).catch(e => console.error(`[envs] stopping the env of done session ${session.id} failed:`, e))
  }
  return { status: body.data.status }
})
