import { randomBytes } from 'node:crypto'
import { dashboardOrigin } from '../../utils/origin'
import { isGithubAppConfigured } from '../../utils/github-credentials'

// GET /api/_setup/status: public (see server/middleware/auth.ts). Tells the
// first-run setup page whether the instance already has a GitHub App, and hands
// it the manifest + CSRF state to POST to GitHub. Once configured, the flow is
// locked: `configured: true` and no manifest is returned.
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

  // The GitHub App manifest. GitHub creates the app from this and returns all its
  // credentials to /setup/callback. Login uses its OAuth client (callback_urls);
  // repo access uses its app id/key; GitHub triggers receive their events via
  // the app webhook (hook_attributes → /api/github/webhook, secret returned by
  // the conversion and stored encrypted). The logo can't be set here: GitHub's
  // manifest has no field for it; upload it once in the app's settings after
  // creation.
  // App names are globally unique on GitHub (and capped at 34 chars), so a
  // fixed name could only ever be claimed by a single instance worldwide.
  // Derive it from this instance's host instead; the creator can still edit
  // the pre-filled name on GitHub's confirmation page before the app is made.
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
      issues: 'read',
    },
    default_events: ['push', 'pull_request', 'issues'],
  }

  // The page builds the POST target from `state` + the chosen owner (personal
  // account vs. an org). A private app can only be installed on the account that
  // owns it, so managing an org's repos requires creating it under that org.
  return {
    configured: false as const,
    state,
    manifest,
  }
})
