import { isGithubAppConfigured, saveGithubAppCredentials } from '../../utils/github-credentials'
import { addMember } from '../../utils/members'

// GET /setup/callback: where GitHub lands after the operator creates the app
// from the manifest. We exchange the one-time `code` for the app's full
// credentials, store them (encrypted), and send the operator on to install the
// app on their repos. First-run only: once configured, the flow is locked.
interface Conversion {
  id: number
  slug: string
  html_url: string
  client_id: string
  client_secret: string
  pem: string
  webhook_secret: string | null
  // The account that created the app, claimed as the instance owner so only
  // they (and whoever they later invite) can log in.
  owner: { login: string }
}

export default defineEventHandler(async (event) => {
  // Locked after first setup: never let a second app overwrite the first.
  if (isGithubAppConfigured()) {
    return sendRedirect(event, '/login')
  }

  const query = getQuery(event)
  const expected = getCookie(event, 'knecht-setup-state')
  deleteCookie(event, 'knecht-setup-state', { path: '/' })
  if (!query.code || !expected || query.state !== expected) {
    return sendRedirect(event, '/setup?error=state')
  }

  try {
    const app = await $fetch<Conversion>(
      `https://api.github.com/app-manifests/${query.code}/conversions`,
      { method: 'POST', headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'knecht' } },
    )

    saveGithubAppCredentials({
      appId: app.id,
      slug: app.slug,
      htmlUrl: app.html_url,
      clientId: app.client_id,
      clientSecret: app.client_secret,
      privateKey: app.pem,
      webhookSecret: app.webhook_secret,
    })

    // Claim the creator as the instance owner: the login allowlist that gates
    // every future sign-in (server/routes/auth/github.get.ts) starts here.
    addMember({ login: app.owner.login, isOwner: true })

    // Straight into installing the app on the operator's repos.
    return sendRedirect(event, `${app.html_url}/installations/new`)
  }
  catch (error) {
    console.error('GitHub App manifest conversion failed:', error)
    return sendRedirect(event, '/setup?error=conversion')
  }
})
