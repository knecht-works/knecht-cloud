import { createPasswordReset } from '../../../stores/password-resets'
import { getMember } from '../../../stores/members'
import { requireOwner } from '../../../utils/owner'
import { defineEventHandler, getRouterParam, createError } from 'h3'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const member = getMember(getRouterParam(event, 'login') ?? '')
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: 'No such member.' })
  }
  return createPasswordReset(member.id)
})
