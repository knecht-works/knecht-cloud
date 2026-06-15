import type { H3Event } from 'h3'
import { rememberGithubToken } from '../../utils/credentials'

// GitHub OAuth: first hit redirects to GitHub, the callback lands back here and
// exchanges the code. The `repo` scope means the returned token can also clone
// repos and open PRs later — login doubles as the repo credential
// (internals/docs/tech-stack.md §3). Single-session gate, no user model.
export default defineOAuthGitHubEventHandler({
  config: {
    // read:user for the profile, repo for clone + PR access.
    scope: ['read:user', 'repo'],
  },

  async onSuccess(event, { user, tokens }) {
    await setUserSession(event, {
      user: {
        login: user.login,
        name: user.name,
        avatarUrl: user.avatar_url,
      },
      // `secure` is encrypted in the cookie and never exposed to the client.
      // Plaintext-at-rest debt is accepted for the MVP (tech-stack.md §2).
      secure: {
        githubToken: tokens.access_token,
      },
    })
    // Persist the token for background trigger runs (no session at fire time).
    rememberGithubToken(tokens.access_token, user.login)
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
