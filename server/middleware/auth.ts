import { INTEGRATIONS } from '../integrations'
import { sessionMember } from '../utils/member-session'

export default defineEventHandler(async (event) => {
  // The router matches the percent-decoded path, so the gate must classify that
  // one: the raw URL lets /%61pi/... skip the gate and still reach /api handlers.
  const pathname = event.path.split('?')[0] ?? '/'

  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  if (isPreviewHost(host)) return

  if (!pathname.startsWith('/api/')) return

  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.method) && isForeignOrigin(getRequestHeader(event, 'origin'), event.node.req.headers.host ?? '')) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request refused' })
  }

  if (pathname.startsWith('/api/_auth/')) return

  if (pathname.startsWith('/api/_setup/')) return

  if (INTEGRATIONS.some(i => pathname === `/api/${i.id}/webhook`)) return

  // Re-checked per request so removing a member or changing the password revokes access immediately.
  if (!sessionMember(await requireUserSession(event))) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Membership revoked' })
  }
})
