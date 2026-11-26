import { z } from 'zod'
import { requireSession } from '#server/stores/sessions'
import { markSessionDone, setObjectlessSessionStatus } from '#server/utils/sessions'
import { requireIntParam, zodBadRequest } from '#server/utils/http'
import { defineEventHandler, readBody, createError } from 'h3'

const bodySchema = z.object({ status: z.enum(['open', 'closed']) })

export default defineEventHandler(async (event) => {
  const session = requireSession(requireIntParam(event))
  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) zodBadRequest(body.error, 'Invalid session status')
  const changed = body.data.status === 'closed' ? markSessionDone(session) : setObjectlessSessionStatus(session, 'open')
  if (!changed) {
    throw createError({ statusCode: 409, statusMessage: 'This session follows its ticket or pull request' })
  }
  return { status: body.data.status }
})
