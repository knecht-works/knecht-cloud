import { isGithubAppConfigured, saveGithubAppCredentials } from '../../utils/github-credentials'
import { addMember } from '../../utils/members'

interface Conversion {
  id: number
  slug: string
  html_url: string
  client_id: string
  client_secret: string
  pem: string
  webhook_secret: string | null
  owner: { login: string }
}

export default defineEventHandler(async (event) => {
  // A second app must never overwrite the first.
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

    addMember({ login: app.owner.login, isOwner: true })

    return sendRedirect(event, `${app.html_url}/installations/new`)
  }
  catch (error) {
    console.error('GitHub App manifest conversion failed:', error)
    return sendRedirect(event, '/setup?error=conversion')
  }
})
