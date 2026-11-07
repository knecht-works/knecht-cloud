import { z } from 'zod'
import { consumePasswordReset } from '../../../stores/password-resets'
import { getMemberById, setPasswordHash } from '../../../stores/members'
import { rememberLoginMethod } from '../../../utils/last-login'
import { isForeignOrigin } from '../../../utils/origin'
import { passwordProblem } from '../../../../shared/utils/account'
import { startMemberSession } from '../../../utils/member-session'

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
  setPasswordHash(member.id, passwordHash)

  await startMemberSession(event, member)
  rememberLoginMethod(event, 'password')
  return { ok: true }
})
