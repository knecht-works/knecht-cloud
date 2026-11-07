import { z } from 'zod'
import { consumeInvite, findOpenInvite } from '../../../stores/invites'
import { addMember, getMember } from '../../../stores/members'
import { rememberLoginMethod } from '../../../utils/last-login'
import { isForeignOrigin } from '../../../utils/origin'
import { passwordProblem, usernameProblem } from '../../../../shared/utils/account'
import { startMemberSession } from '../../../utils/member-session'

const bodySchema = z.object({
  username: z.string().trim().superRefine((v, ctx) => {
    const problem = usernameProblem(v)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
  password: z.string().max(1024).superRefine((v, ctx) => {
    const problem = passwordProblem(v)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
})

export default defineEventHandler(async (event) => {
  if (isForeignOrigin(getRequestHeader(event, 'origin'), event.node.req.headers.host ?? '')) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request refused' })
  }
  const token = getRouterParam(event, 'token') ?? ''
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    const issue = result.error.issues[0]!
    throw createError({ statusCode: 400, statusMessage: issue.message, data: { field: issue.path[0] } })
  }
  if (!findOpenInvite(token)) {
    throw createError({ statusCode: 404, statusMessage: 'This invite link is invalid or has expired.' })
  }
  const { username, password } = result.data
  if (getMember(username)) {
    throw createError({ statusCode: 409, statusMessage: 'That username is taken.', data: { field: 'username' } })
  }

  const passwordHash = await hashPassword(password)
  const invite = consumeInvite(token)
  if (!invite) {
    throw createError({ statusCode: 404, statusMessage: 'This invite link is invalid or has expired.' })
  }
  const member = addMember({ login: username, passwordHash, invitedBy: invite.createdBy })

  await startMemberSession(event, member)
  rememberLoginMethod(event, 'password')
  return { ok: true }
})
