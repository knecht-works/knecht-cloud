import { z } from 'zod'
import { getMember, listMembers, setOwner } from '../../stores/members'
import { requireOwner } from '../../utils/owner'

const bodySchema = z.object({ isOwner: z.boolean() })

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const member = getMember(getRouterParam(event, 'login') ?? '')
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: 'No such member.' })
  }
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Send isOwner as true or false.' })
  }
  if (!setOwner(member.id, result.data.isOwner)) {
    throw createError({ statusCode: 409, statusMessage: 'The instance needs at least one owner.' })
  }
  return listMembers()
})
