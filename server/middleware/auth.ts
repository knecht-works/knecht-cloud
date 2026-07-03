import { isMember, memberCount } from '../utils/members'

// Secure-by-default gate. Every /api/** route requires a logged-in session, so
// new routes are protected automatically — no need to remember requireUserSession
// per handler. Only the auth endpoints (and non-API paths) are exempt.
export default defineEventHandler(async (event) => {
  const { pathname } = getRequestURL(event)

  // Preview subdomains are their own origin, served entirely by the preview
  // proxy — which does its own session check (proxyRunPreview). Skip the
  // dashboard /api gate so the proxy owns gating for the whole preview origin.
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  if (isPreviewHost(host)) return

  // Pages, assets, the OAuth flow (/auth/**) render/handle their own access.
  if (!pathname.startsWith('/api/')) return

  // nuxt-auth-utils' own session endpoint must stay reachable when logged out
  // (the client uses it to learn whether there IS a session).
  if (pathname.startsWith('/api/_auth/')) return

  // First-run setup status is public — before a GitHub App exists nobody can log
  // in, so the setup page must be able to read it logged-out. It leaks nothing
  // once configured (just `{ configured: true }`).
  if (pathname.startsWith('/api/_setup/')) return

  // GitHub trigger webhooks are authenticated by their HMAC signature, not a
  // session — GitHub can't carry one. The handler verifies the signature itself.
  if (/^\/api\/triggers\/\d+\/webhook$/.test(pathname)) return

  const { user } = await requireUserSession(event)

  // The sealed session cookie stays valid until it expires, so membership is
  // re-checked per request — removing a member (server/api/members) revokes
  // access immediately, not days later. Empty table = instance set up before
  // member gating existed; the next login claims ownership (routes/auth/github).
  if (memberCount() > 0 && !isMember(user.login)) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Membership revoked' })
  }
})
