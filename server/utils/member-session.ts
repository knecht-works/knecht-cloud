import type { H3Event } from 'h3'
import type { UserSession } from '#auth-utils'
import type { Member } from '../db/schema'
import { getMemberById } from '../stores/members'

const sessionUser = (member: Member) => ({ id: member.id, login: member.login, name: member.name, avatarUrl: member.avatarUrl })

export function startMemberSession(event: H3Event, member: Member) {
  return replaceUserSession(event, { user: sessionUser(member), sessionVersion: member.sessionVersion })
}

export function updateMemberSession(event: H3Event, member: Member) {
  return replaceUserSession(event, { user: sessionUser(member), sessionVersion: member.sessionVersion })
}

// Undefined once the member is removed or has changed their password since this session started.
export function sessionMember(session: UserSession): Member | undefined {
  const member = getMemberById(session.user?.id)
  return member && member.sessionVersion === (session.sessionVersion ?? 0) ? member : undefined
}
