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
  // repo access uses its app id/key. `hook_attributes` is omitted deliberately:
  // including it makes its `url` sub-field required, and we use no webhook. The
  // logo can't be set here: GitHub's manifest has no field for it; upload it
  // once in the app's settings after creation.
  const manifest = {
    name: 'Knecht Works',
    url: origin,
    description: 'Boot, fix and test your repos automatically with Knecht.',
    redirect_url: `${origin}/setup/callback`,
    callback_urls: [`${origin}/auth/github`],
    // Public so ANY GitHub user can complete the OAuth identity flow: a PRIVATE
    // app 404s the authorize page for anyone but the owner (or owning-org
    // members), which would make invited users unable to log in at all. Who may
    // actually get a session is gated by Knecht's own allowlist (the `members`
    // table, server/utils/members.ts), not by GitHub App visibility. Public only
    // means others could *install* the app on their own repos, which is harmless, since
    // Knecht only ever uses installations it's told about, and login stays gated.
    public: true,
    default_permissions: {
      contents: 'write',
      pull_requests: 'write',
      metadata: 'read',
    },
    default_events: [],
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
