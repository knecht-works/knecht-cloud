import { getMember, listMembers, removeMember } from '../../utils/members'

// DELETE /api/members/:login → revoke access. The owner is protected so the
// instance always keeps its original claim; everyone else can be removed by any
// member (they lose access on their next request / once their session expires).
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
