import { findOpenPasswordReset } from '../../../stores/password-resets'
import { getMemberById } from '../../../stores/members'

export default defineEventHandler((event) => {
  const reset = findOpenPasswordReset(getRouterParam(event, 'token') ?? '')
  const member = reset && getMemberById(reset.memberId)
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: 'This reset link is invalid or has expired.' })
  }
  return { username: member.login }
})
