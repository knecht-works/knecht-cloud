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

  // GitHub trigger webhooks are authenticated by their HMAC signature, not a
  // session — GitHub can't carry one. The handler verifies the signature itself.
  if (/^\/api\/triggers\/\d+\/webhook$/.test(pathname)) return

  await requireUserSession(event)
})
