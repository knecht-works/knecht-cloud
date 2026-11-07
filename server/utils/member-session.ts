import type { H3Event } from 'h3'
import type { Member } from '../db/schema'
import { isElevated } from '../../shared/utils/elevation'

const sessionUser = (member: Member) => ({ id: member.id, login: member.login, name: member.name, avatarUrl: member.avatarUrl })

// A login proves who the member is, so the new session starts elevated.
export function startMemberSession(event: H3Event, member: Member) {
  return replaceUserSession(event, { user: sessionUser(member), elevatedAt: Date.now() })
}

// For profile changes: keeps the elevation, so editing a picture never extends it.
export async function updateMemberSession(event: H3Event, member: Member) {
  const { elevatedAt } = await getUserSession(event)
  return replaceUserSession(event, { user: sessionUser(member), elevatedAt })
}

export async function elevateSession(event: H3Event) {
  const { user } = await requireUserSession(event)
  return replaceUserSession(event, { user, elevatedAt: Date.now() })
}

// Sensitive actions need a login or confirmation within the last hour. The
// dashboard answers `reauth` with the "Confirm it's you" dialog and retries.
export async function requireElevated(event: H3Event) {
  const session = await requireUserSession(event)
  if (!isElevated(session.elevatedAt)) {
    throw createError({ statusCode: 403, statusMessage: 'Confirm it’s you to continue.', data: { reauth: true } })
  }
  return session
}
