import type { Octokit } from 'octokit'
import { App } from 'octokit'

// GitHub App auth — the app's own identity replaces user OAuth tokens for all
// repo access (clone, push, PR, file reads). The app authenticates with its
// private key and mints short-lived (1h) installation tokens per repo, so no
// user credential is ever stored. Login (OAuth) is identity-only now.
//
// Setup: create a GitHub App with Contents read/write, Pull requests read/write
// and Metadata read, install it on the repos Knecht should manage, and set
// KNECHT_GITHUB_APP_ID + KNECHT_GITHUB_APP_PRIVATE_KEY.

let cachedApp: App | null = null

export function isGithubAppConfigured(): boolean {
  return !!(process.env.KNECHT_GITHUB_APP_ID && process.env.KNECHT_GITHUB_APP_PRIVATE_KEY)
}

function getApp(): App {
  if (cachedApp) return cachedApp
  if (!isGithubAppConfigured()) {
    throw new Error(
      'GitHub App not configured — set KNECHT_GITHUB_APP_ID and KNECHT_GITHUB_APP_PRIVATE_KEY (see .env.example).',
    )
  }
  cachedApp = new App({
    appId: process.env.KNECHT_GITHUB_APP_ID!,
    privateKey: normalizePrivateKey(process.env.KNECHT_GITHUB_APP_PRIVATE_KEY!),
  })
  return cachedApp
}

// Accept the PEM in any of the shapes an env var realistically carries it:
// real newlines, literal \n escapes, or base64-encoded (the foolproof one-liner:
// `base64 < key.pem | tr -d '\n'`). Fails loudly here instead of surfacing as a
// cryptic ASN.1 error from the crypto layer.
function normalizePrivateKey(raw: string): string {
  let key = raw.trim().replace(/\\n/g, '\n')
  if (!key.includes('-----BEGIN')) {
    key = Buffer.from(key, 'base64').toString('utf8')
  }
  if (!key.includes('-----BEGIN') || !key.includes('-----END')) {
    throw new Error(
      'KNECHT_GITHUB_APP_PRIVATE_KEY is not a valid PEM — paste the .pem file\'s '
      + 'content (base64-encoded, \\n-escaped, or with real newlines). Note that '
      + '$(…) command substitution does not work inside .env files.',
    )
  }
  return key
}

// owner/repo → installation id. Installations change rarely (uninstall/reinstall),
// so a plain in-process cache is fine; a stale hit surfaces as a 404 on token
// creation and clears itself on the next boot.
const installationIds = new Map<string, number>()

async function getInstallationId(owner: string, repo: string): Promise<number> {
  const key = `${owner}/${repo}`
  const cached = installationIds.get(key)
  if (cached) return cached
  try {
    const { data } = await getApp().octokit.rest.apps.getRepoInstallation({ owner, repo })
    installationIds.set(key, data.id)
    return data.id
  }
  catch (e) {
    if ((e as { status?: number }).status === 404) {
      throw new Error(`GitHub App is not installed on ${key} — install it on the repo and try again.`, { cause: e })
    }
    throw e
  }
}

// An Octokit authenticated as the repo's installation, for REST calls (file
// reads, PR creation). Token refresh is handled internally per request.
export async function getInstallationClient(owner: string, repo: string): Promise<Octokit> {
  return getApp().getInstallationOctokit(await getInstallationId(owner, repo))
}

// A raw installation token for git network operations (clone/fetch/push), where
// no Octokit is in play. Tokens live 1h; cached per repo and re-minted with a
// safety margin so a token handed out here is good for at least ~10 minutes.
const tokenCache = new Map<string, { token: string, expiresAt: number }>()

export async function getInstallationToken(owner: string, repo: string): Promise<string> {
  const key = `${owner}/${repo}`
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt - Date.now() > 10 * 60_000) return cached.token

  const installationId = await getInstallationId(owner, repo)
  const { data } = await getApp().octokit.rest.apps.createInstallationAccessToken({
    installation_id: installationId,
    repositories: [repo],
  })
  tokenCache.set(key, { token: data.token, expiresAt: new Date(data.expires_at).getTime() })
  return data.token
}

// Every repo the app is installed on, across all installations — the source for
// the "connect a repo" picker.
export async function listAppRepositories() {
  const repos = []
  for await (const { repository } of getApp().eachRepository.iterator()) {
    repos.push(repository)
  }
  return repos
}
