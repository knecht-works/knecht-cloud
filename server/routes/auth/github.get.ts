import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { withQuery } from 'ufo'
import { dashboardOrigin } from '../../utils/origin'
import { githubAppCredentials } from '../../utils/github-credentials'
import { consumeInvite } from '../../stores/invites'
import { rememberLoginMethod } from '../../utils/last-login'
import { addMember, getMember, getMemberById, linkIdentity, loginWithIdentity } from '../../stores/members'

// Hand-rolled OAuth: the client id and secret live in the DB (setup flow), not in static config.
export default defineEventHandler(async (event) => {
  const creds = githubAppCredentials()
  if (!creds?.clientId || !creds.clientSecret) {
    return sendRedirect(event, '/setup')
  }

  const redirectUri = `${dashboardOrigin() || getRequestURL(event).origin}/auth/github`
  const query = getQuery(event)

  if (!query.code) {
    const state = randomBytes(16).toString('hex')
    setCookie(event, 'knecht-oauth-state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    })
    if (query.link) {
      setCookie(event, 'knecht-link', '1', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 })
    }
    if (typeof query.invite === 'string') {
      setCookie(event, 'knecht-invite', query.invite, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 })
    }
    return sendRedirect(event, withQuery('https://github.com/login/oauth/authorize', {
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user',
      state,
    }))
  }

  const expected = getCookie(event, 'knecht-oauth-state')
  deleteCookie(event, 'knecht-oauth-state', { path: '/' })
  const inviteToken = getCookie(event, 'knecht-invite')
  deleteCookie(event, 'knecht-invite', { path: '/' })
  const linking = getCookie(event, 'knecht-link') === '1'
  deleteCookie(event, 'knecht-link', { path: '/' })
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

    const user = await $fetch<{ id: number, login: string, name: string | null, avatar_url: string }>(
      'https://api.github.com/user',
      { headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'User-Agent': 'knecht' } },
    )

    const account = { subject: String(user.id), username: user.login }
    const profile = { name: user.name, avatarUrl: user.avatar_url }

    if (linking) {
      const current = getMemberById((await getUserSession(event)).user?.id)
      if (!current) return sendRedirect(event, '/login')
      return sendRedirect(event, `/settings?github=${linkIdentity(current.id, 'github', account)}`)
    }
    let member = loginWithIdentity('github', account, profile)
    if (!member && inviteToken) {
      if (getMember(user.login)) return sendRedirect(event, `/join/${encodeURIComponent(inviteToken)}?error=username`)
      const invite = consumeInvite(inviteToken)
      if (!invite) return sendRedirect(event, `/join/${encodeURIComponent(inviteToken)}`)
      addMember({ login: user.login, invitedBy: invite.createdBy, identity: { provider: 'github', username: user.login } })
      member = loginWithIdentity('github', account, profile)
    }
    if (!member) {
      console.warn(`Login denied for @${user.login}: not a member of this instance.`)
      return sendRedirect(event, '/login?error=forbidden')
    }

    await setUserSession(event, { user: { id: member.id, login: member.login, name: member.name, avatarUrl: member.avatarUrl } })
    rememberLoginMethod(event, 'github')
    return sendRedirect(event, popRedirect(event))
  }
  catch (error) {
    console.error('GitHub OAuth error:', error)
    return sendRedirect(event, '/login?error=oauth')
  }
})

// Only our own base domain is honored (no open redirect).
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
    // Malformed stored URL: fall through to the dashboard.
  }
  return '/'
}
