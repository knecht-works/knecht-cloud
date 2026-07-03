import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { withQuery } from 'ufo'
import { dashboardOrigin } from '../../utils/origin'
import { githubAppCredentials } from '../../utils/github-credentials'
import { addMember, isMember, memberCount, touchProfile } from '../../utils/members'

// GitHub OAuth login. One endpoint, two hits: the first (no `code`) redirects to
// GitHub; the callback lands back here with `code` and is exchanged for an
// identity. Login is identity-only — repo access (clone, PR, file reads) comes
// from the GitHub App (server/utils/github-app.ts), so no user token is kept
// beyond this request. Single-session gate, no user model.
//
// The client id/secret come from the DB-stored GitHub App (created via the setup
// flow), not env — so this is a hand-rolled OAuth dance rather than
// nuxt-auth-utils' defineOAuthGitHubEventHandler, which only reads static config.
export default defineEventHandler(async (event) => {
  const creds = githubAppCredentials()
  if (!creds?.clientId || !creds.clientSecret) {
    // Not set up yet — send them through first-run setup.
    return sendRedirect(event, '/setup')
  }

  const redirectUri = `${dashboardOrigin() || getRequestURL(event).origin}/auth/github`
  const query = getQuery(event)

  // First hit: no code → bounce to GitHub with a CSRF state we stash in a cookie.
  if (!query.code) {
    const state = randomBytes(16).toString('hex')
    setCookie(event, 'knecht-oauth-state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    })
    return sendRedirect(event, withQuery('https://github.com/login/oauth/authorize', {
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user',
      state,
    }))
  }

  // Callback: verify state, then exchange the code for a token and an identity.
  const expected = getCookie(event, 'knecht-oauth-state')
  deleteCookie(event, 'knecht-oauth-state', { path: '/' })
  if (!expected || query.state !== expected) {
    console.error('GitHub OAuth error: state mismatch')
    return sendRedirect(event, '/login?error=oauth')
  }

  try {
    const tokens = await $fetch<{ access_token?: string, error?: string }>(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: {
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          code: query.code,
          redirect_uri: redirectUri,
        },
      },
    )
    if (!tokens.access_token) throw new Error(tokens.error || 'no access_token')

    const user = await $fetch<{ login: string, name: string | null, avatar_url: string }>(
      'https://api.github.com/user',
      { headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'User-Agent': 'knecht' } },
    )

    // The login gate. Normally setup already claimed the owner, so this just
    // checks membership; the empty-table case (an instance set up before member
    // gating existed) lets the first successful login claim ownership.
    const profile = { login: user.login, name: user.name, avatarUrl: user.avatar_url }
    if (memberCount() === 0) {
      addMember({ ...profile, isOwner: true })
    }
    else if (!isMember(user.login)) {
      console.warn(`Login denied for @${user.login} — not a member of this instance.`)
      return sendRedirect(event, '/login?error=forbidden')
    }
    else {
      touchProfile(profile)
    }

    await setUserSession(event, { user: profile })
    return sendRedirect(event, popRedirect(event))
  }
  catch (error) {
    console.error('GitHub OAuth error:', error)
    return sendRedirect(event, '/login?error=oauth')
  }
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
