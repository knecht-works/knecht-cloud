import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { githubAppCredentials } from '../../utils/github-credentials'
import { getAppWebhookState } from '../../utils/github-app'
import { dashboardOrigin } from '../../utils/origin'

// GET /api/github/webhook-status → checklist for the app webhook (settings
// card). Everything is configured automatically when the app is created at
// setup; this only verifies it. The secret lives locally; URL, event
// subscriptions and the Issues permission live on GitHub and are read via the
// app JWT. `settingsUrl` points the operator at the app's settings page in
// case something was changed there and needs fixing.
export default defineEventHandler(async () => {
  const creds = githubAppCredentials()
  const endpoint = dashboardOrigin() ? `${dashboardOrigin()}/api/github/webhook` : null
  const row = db.select({ slug: schema.githubApp.slug }).from(schema.githubApp).where(eq(schema.githubApp.id, 1)).get()

  const base = {
    configured: !!creds,
    endpoint,
    secretConfigured: !!creds?.webhookSecret,
    // Best-effort: correct for user-owned apps; org-owned apps live under the
    // org's settings, where GitHub guides the operator after login.
    settingsUrl: row?.slug ? `https://github.com/settings/apps/${row.slug}` : null,
  }
  if (!creds) return { ...base, github: null, ready: false }

  try {
    const state = await getAppWebhookState()
    const github = {
      // Where the app's webhook currently points. Any URL counts as configured:
      // in dev it's deliberately a forwarder (smee) relaying to this instance,
      // so the UI shows a mismatch as a hint, not a blocker.
      url: state.url,
      urlConfigured: !!state.url,
      events: {
        push: state.events.includes('push'),
        pull_request: state.events.includes('pull_request'),
        issues: state.events.includes('issues'),
      },
      issuesPermission: state.issuesPermission,
    }
    const ready = base.secretConfigured
      && github.urlConfigured
      && github.events.push
      && github.events.pull_request
      && github.events.issues
    return { ...base, github, ready }
  }
  catch (error) {
    // GitHub unreachable: report what we know locally, the card shows the
    // remote checks as unknown.
    console.error('GitHub App webhook status check failed:', error)
    return { ...base, github: null, ready: false }
  }
})
