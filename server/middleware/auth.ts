import { INTEGRATIONS } from '../integrations'
import { addMember, isMember, memberCount } from '../utils/members'

export default defineEventHandler(async (event) => {
  const { pathname } = getRequestURL(event)

  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  if (isPreviewHost(host)) return

  if (!pathname.startsWith('/api/')) return

  if (pathname.startsWith('/api/_auth/')) return

  if (pathname.startsWith('/api/_setup/')) return

  if (INTEGRATIONS.some(i => pathname === `/api/${i.id}/webhook`)) return

  const { user } = await requireUserSession(event)

  // Empty members table: the first authenticated request claims the owner,
  // otherwise an instance from before member gating would lock itself out.
  if (memberCount() === 0) {
    addMember({ login: user.login, name: user.name, avatarUrl: user.avatarUrl, isOwner: true })
    return
  }

  // Re-checked per request so removing a member revokes access immediately.
  if (!isMember(user.login)) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Membership revoked' })
  }
})
