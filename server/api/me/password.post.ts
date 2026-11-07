import { z } from 'zod'
import { setPasswordHash } from '../../stores/members'
import { requireElevated, updateMemberSession } from '../../utils/member-session'
import { passwordProblem } from '../../../shared/utils/account'

const bodySchema = z.object({
  password: z.string().max(1024).superRefine((v, ctx) => {
    const problem = passwordProblem(v)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireElevated(event)
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]!.message, data: { field: 'password' } })
  }
  await updateMemberSession(event, setPasswordHash(user.id, await hashPassword(result.data.password)))
  return { ok: true }
})
