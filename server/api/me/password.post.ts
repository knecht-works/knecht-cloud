import { z } from 'zod'
import { getMemberById, setPasswordHash } from '../../stores/members'
import { isLoginBlocked, recordLoginFailure } from '../../utils/login-attempts'
import { passwordProblem } from '../../../shared/utils/account'

const bodySchema = z.object({
  currentPassword: z.string().max(1024).optional(),
  password: z.string().max(1024).superRefine((v, ctx) => {
    const problem = passwordProblem(v)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const member = getMemberById(user.id)!
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]!.message, data: { field: 'password' } })
  }

  if (member.passwordHash) {
    const keys = [`user:${member.login}`]
    if (isLoginBlocked(keys)) {
      throw createError({ statusCode: 429, statusMessage: 'Too many failed attempts. Try again in 15 minutes.' })
    }
    if (!await verifyPassword(member.passwordHash, result.data.currentPassword ?? '')) {
      recordLoginFailure(keys)
      throw createError({ statusCode: 400, statusMessage: 'That is not your current password.', data: { field: 'currentPassword' } })
    }
  }

  setPasswordHash(member.id, await hashPassword(result.data.password))
  return { ok: true }
})
