import { getMember, listMembers, removeMember } from '../../utils/members'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)

  const login = getRouterParam(event, 'login')
  if (!login) {
    throw createError({ statusCode: 400, statusMessage: 'Missing login.' })
  }

  const member = getMember(login)
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: 'No such member.' })
  }
  if (member.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'The owner can’t be removed.' })
  }

  removeMember(login)
  return listMembers()
})
