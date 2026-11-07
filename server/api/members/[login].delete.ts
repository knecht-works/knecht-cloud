import { getMember, listMembers, removeMember } from '../../stores/members'
import { requireOwner } from '../../utils/owner'
import { requireElevated } from '../../utils/member-session'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  await requireElevated(event)

  const login = getRouterParam(event, 'login')
  if (!login) {
    throw createError({ statusCode: 400, statusMessage: 'Missing login.' })
  }

  const member = getMember(login)
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: 'No such member.' })
  }
  if (member.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'An owner can’t be removed. Remove the owner role first.' })
  }

  removeMember(login)
  return listMembers()
})
