import { randomBytes } from 'node:crypto'
import { dashboardOrigin } from '../../utils/origin'
import { isGithubAppConfigured } from '../../utils/github-credentials'

export default defineEventHandler((event) => {
  if (isGithubAppConfigured()) {
    return { configured: true as const }
  }

  const origin = dashboardOrigin()
  if (!origin) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Set KNECHT_BASE_URL (dev) or KNECHT_BASE_DOMAIN (prod) so the '
        + 'GitHub App callback URLs can be built.',
    })
  }

  const state = randomBytes(16).toString('hex')
  setCookie(event, 'knecht-setup-state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  // GitHub app names are globally unique and capped at 34 chars. The manifest has no logo field.
  const host = new URL(origin).hostname.replace(/[^a-z0-9-]+/gi, '-')
  const manifest = {
    name: `Knecht ${host}`.slice(0, 34).replace(/[\s-]+$/, ''),
    url: origin,
    description: 'Boot, fix and test your repos automatically with Knecht.',
    redirect_url: `${origin}/setup/callback`,
    setup_url: `${origin}/login`,
    callback_urls: [`${origin}/auth/github`],
    public: true,
    hook_attributes: {
      url: `${origin}/api/github/webhook`,
    },
    default_permissions: {
      contents: 'write',
      pull_requests: 'write',
      metadata: 'read',
      // PR conversation comments go through the issues API too.
      issues: 'write',
    },
    default_events: ['pull_request', 'issues', 'issue_comment'],
  }

  // The page picks the owner: an app can only be installed on the account
  // that owns it, so org repos need the app created under that org.
  return {
    configured: false as const,
    state,
    manifest,
  }
})
