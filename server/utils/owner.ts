import type { H3Event } from 'h3'
import { getMemberById } from '../stores/members'
import type { Member } from '../db/schema'

export async function requireOwner(event: H3Event): Promise<Member> {
  const { user } = await requireUserSession(event)
  const member = getMemberById(user.id)
  if (!member?.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Only an owner can do this.' })
  }
  return member
}
