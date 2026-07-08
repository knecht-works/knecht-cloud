import { addMember, isMember, memberCount } from '../utils/members'

// Secure-by-default gate. Every /api/** route requires a logged-in session, so
// new routes are protected automatically: no need to remember requireUserSession
// per handler. Only the auth endpoints (and non-API paths) are exempt.
export default defineEventHandler(async (event) => {
  const { pathname } = getRequestURL(event)

  // Preview subdomains are their own origin, served entirely by the preview
  // proxy, which does its own session check (proxyRunPreview). Skip the
  // dashboard /api gate so the proxy owns gating for the whole preview origin.
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  if (isPreviewHost(host)) return

  // Pages, assets, the OAuth flow (/auth/**) render/handle their own access.
  if (!pathname.startsWith('/api/')) return

  // nuxt-auth-utils' own session endpoint must stay reachable when logged out
  // (the client uses it to learn whether there IS a session).
  if (pathname.startsWith('/api/_auth/')) return

  // First-run setup status is public: before a GitHub App exists nobody can log
  // in, so the setup page must be able to read it logged-out. It leaks nothing
  // once configured (just `{ configured: true }`).
  if (pathname.startsWith('/api/_setup/')) return

  // The GitHub App webhook is authenticated by its HMAC signature, not a
  // session: GitHub can't carry one. The handler verifies the signature itself.
  if (pathname === '/api/github/webhook') return

  const { user } = await requireUserSession(event)

  // Empty table = an instance set up before member gating existed (setup seeds
  // the owner now, but older instances have no row and their operator is already
  // logged in, so the login-time claim never fires). Self-heal: the first
  // authenticated request claims the current user as owner: otherwise inviting
  // anyone would flip memberCount > 0 and lock the un-claimed operator out below.
  if (memberCount() === 0) {
    addMember({ login: user.login, name: user.name, avatarUrl: user.avatarUrl, isOwner: true })
    return
  }

  // The sealed session cookie stays valid until it expires, so membership is
  // re-checked per request: removing a member (server/api/members) revokes
  // access immediately, not days later.
  if (!isMember(user.login)) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Membership revoked' })
  }
})
