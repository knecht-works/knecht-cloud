import type { H3Event } from 'h3'
import type { Member } from '../db/schema'

export function setMemberSession(event: H3Event, member: Member) {
  return replaceUserSession(event, { user: { id: member.id, login: member.login, name: member.name, avatarUrl: member.avatarUrl } })
}
