import { z } from 'zod'
import { consumePasswordReset } from '#server/stores/password-resets'
import { getMemberById, setPasswordHash } from '#server/stores/members'
import { rememberLoginMethod } from '#server/utils/last-login'
import { isForeignOrigin } from '#server/utils/origin'
import { passwordProblem } from '#shared/utils/account'
import { startMemberSession } from '#server/utils/member-session'
import { defineEventHandler, getRequestHeader, createError, readBody, getRouterParam } from 'h3'
import { hashPassword } from '#imports'

const bodySchema = z.object({
  password: z.string().max(1024).superRefine((v, ctx) => {
    const problem = passwordProblem(v)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
})

export default defineEventHandler(async (event) => {
  if (isForeignOrigin(getRequestHeader(event, 'origin'), event.node.req.headers.host ?? '')) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request refused' })
  }
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]!.message, data: { field: 'password' } })
  }

  const passwordHash = await hashPassword(result.data.password)
  const reset = consumePasswordReset(getRouterParam(event, 'token') ?? '')
  const member = reset && getMemberById(reset.memberId)
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: 'This reset link is invalid or has expired.' })
  }
  await startMemberSession(event, setPasswordHash(member.id, passwordHash))
  rememberLoginMethod(event, 'password')
  return { ok: true }
})
