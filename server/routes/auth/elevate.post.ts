import { z } from 'zod'
import { getMemberById } from '../../stores/members'
import { elevateSession } from '../../utils/member-session'
import { isLoginBlocked, recordLoginFailure } from '../../utils/login-attempts'
import { isForeignOrigin } from '../../utils/origin'

const bodySchema = z.object({ password: z.string().min(1).max(1024) })

export default defineEventHandler(async (event) => {
  if (isForeignOrigin(getRequestHeader(event, 'origin'), event.node.req.headers.host ?? '')) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request refused' })
  }
  const { user } = await requireUserSession(event)
  const member = getMemberById(user.id)
  const result = bodySchema.safeParse(await readBody(event))
  if (!member?.passwordHash || !result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Enter your password.', data: { field: 'password' } })
  }
  const keys = [`user:${member.login}`]
  if (isLoginBlocked(keys)) {
    throw createError({ statusCode: 429, statusMessage: 'Too many failed attempts. Try again in 15 minutes.' })
  }
  if (!await verifyPassword(member.passwordHash, result.data.password)) {
    recordLoginFailure(keys)
    throw createError({ statusCode: 400, statusMessage: 'That is not your password.', data: { field: 'password' } })
  }
  await elevateSession(event)
  return { ok: true }
})
