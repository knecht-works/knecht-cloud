import { z } from 'zod'
import { addMember, isMember, listMembers } from '../../utils/members'

// GitHub usernames are at most 39 chars of alphanumerics and single hyphens.
const bodySchema = z.object({
  login: z.string().trim().min(1).max(39).regex(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a valid GitHub username.' })
  }

  const { login } = result.data
  if (isMember(login)) {
    throw createError({ statusCode: 409, statusMessage: 'That user is already a member.' })
  }

  addMember({ login, invitedBy: user.login })
  return listMembers()
})
