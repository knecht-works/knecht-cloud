import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { withQuery } from 'ufo'
import { dashboardOrigin, localPath } from '../../utils/origin'
import { githubAppCredentials } from '../../utils/github-credentials'
import { consumeInvite } from '../../stores/invites'
import { rememberLoginMethod } from '../../utils/last-login'
import { addMember, getMember, getMemberById, linkIdentity, listIdentities, loginWithIdentity } from '../../stores/members'
import { isElevated } from '../../../shared/utils/elevation'
import { elevateSession, startMemberSession } from '../../utils/member-session'

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
    setFlowCookie(event, 'oauth-state', state)
    if (query.link || query.elevate) setFlowCookie(event, 'link', query.link ? 'link' : 'elevate')
    const returnTo = localPath(query.return)
    if (returnTo) setFlowCookie(event, 'return', returnTo)
    if (typeof query.invite === 'string') setFlowCookie(event, 'invite', query.invite)
    return sendRedirect(event, withQuery('https://github.com/login/oauth/authorize', {
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user',
      state,
    }))
  }

  const expected = popFlowCookie(event, 'oauth-state')
  const inviteToken = popFlowCookie(event, 'invite')
  const mode = popFlowCookie(event, 'link')
  const returnTo = localPath(popFlowCookie(event, 'return')) ?? '/'
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

    if (mode === 'link' || mode === 'elevate') {
      const session = await getUserSession(event)
      const current = getMemberById(session.user?.id)
      if (!current) return sendRedirect(event, '/login')
      if (mode === 'elevate') {
        const own = listIdentities(current.id).some(i => i.provider === 'github' && i.subject === account.subject)
        if (own) await elevateSession(event)
        return sendRedirect(event, withQuery(returnTo, { reauth: own ? 'done' : 'mismatch' }))
      }
      if (!isElevated(session.elevatedAt)) return sendRedirect(event, '/profile?github=reauth')
      return sendRedirect(event, `/profile?github=${linkIdentity(current.id, 'github', account)}`)
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

    await startMemberSession(event, member)
    rememberLoginMethod(event, 'github')
    return sendRedirect(event, popRedirect(event))
  }
  catch (error) {
    console.error('GitHub OAuth error:', error)
    return sendRedirect(event, '/login?error=oauth')
  }
})

// __Host- cookies cannot be planted by a preview subdomain, so a callback only
// completes a flow this browser started here. Plain http (dev) cannot set them.
const secure = process.env.NODE_ENV === 'production'
const flowCookie = (name: string) => `${secure ? '__Host-' : ''}knecht-${name}`

function setFlowCookie(event: H3Event, name: string, value: string) {
  setCookie(event, flowCookie(name), value, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 600 })
}

function popFlowCookie(event: H3Event, name: string): string | undefined {
  const value = getCookie(event, flowCookie(name))
  deleteCookie(event, flowCookie(name), { secure, path: '/' })
  return value
}

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
