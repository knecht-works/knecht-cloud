import type { H3Event } from 'h3'

// GitHub OAuth: first hit redirects to GitHub, the callback lands back here and
// exchanges the code. Login is identity-only — repo access (clone, PR, file
// reads) comes from the GitHub App (server/utils/github-app.ts), so no user
// token is kept beyond this request. Single-session gate, no user model.
export default defineOAuthGitHubEventHandler({
  config: {
    // Profile only — no repo scope; the GitHub App owns repo access.
    scope: ['read:user'],
  },

  async onSuccess(event, { user }) {
    await setUserSession(event, {
      user: {
        login: user.login,
        name: user.name,
        avatarUrl: user.avatar_url,
      },
    })
    return sendRedirect(event, popRedirect(event))
  },

  onError(event, error) {
    console.error('GitHub OAuth error:', error)
    return sendRedirect(event, '/login?error=oauth')
  },
})

// Consume the post-login redirect target left by the preview proxy. Only our
// own base domain is allowed (no open redirect); anything else → dashboard.
function popRedirect(event: H3Event): string {
  const raw = getCookie(event, 'knecht-redirect')
  const domain = process.env.KNECHT_BASE_DOMAIN || undefined
  deleteCookie(event, 'knecht-redirect', { domain, path: '/' })
  if (!raw) return '/'
  try {
    const { hostname } = new URL(raw)
    const base = process.env.KNECHT_BASE_DOMAIN
    if (base && (hostname === base || hostname.endsWith(`.${base}`))) return raw
  }
  catch {
    // Malformed stored URL — fall through to the dashboard.
  }
  return '/'
}
