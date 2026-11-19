import { findOpenPasswordReset } from '#server/stores/password-resets'
import { getMemberById } from '#server/stores/members'
import { defineEventHandler, getRouterParam, createError } from 'h3'

export default defineEventHandler((event) => {
  const reset = findOpenPasswordReset(getRouterParam(event, 'token') ?? '')
  const member = reset && getMemberById(reset.memberId)
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: 'This reset link is invalid or has expired.' })
  }
  return { username: member.login }
})
