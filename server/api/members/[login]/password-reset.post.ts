import { createPasswordReset } from '../../../stores/password-resets'
import { getMember } from '../../../stores/members'
import { requireOwner } from '../../../utils/owner'
import { requireElevated } from '../../../utils/member-session'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  await requireElevated(event)
  const member = getMember(getRouterParam(event, 'login') ?? '')
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: 'No such member.' })
  }
  return createPasswordReset(member.id)
})
