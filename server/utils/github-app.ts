import type { Octokit } from 'octokit'
import { App } from 'octokit'
import { githubAppCredentials } from './github-credentials'

// GitHub App auth: the app's own identity replaces user OAuth tokens for all
// repo access (clone, push, PR, file reads). The app authenticates with its
// private key and mints short-lived (1h) installation tokens per repo, so no
// user credential is ever stored. Login (OAuth) is identity-only now.
//
// The app is created from the UI on first run (server/routes/setup/*) and its
// credentials live encrypted in the DB (see server/utils/github-credentials.ts).

let cachedApp: App | null = null
let cachedForAppId: string | null = null

function getApp(): App {
  const creds = githubAppCredentials()
  if (!creds) {
    throw new Error(
      'GitHub App not configured. Open the dashboard and complete the GitHub App setup.',
    )
  }
  // Rebuild if the configured app changed (e.g. first-run setup happened after a
  // failed repo call). Steady state: built once, reused.
  if (cachedApp && cachedForAppId === creds.appId) return cachedApp
  cachedApp = new App({ appId: creds.appId, privateKey: creds.privateKey })
  cachedForAppId = creds.appId
  return cachedApp
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
      throw new Error(`GitHub App is not installed on ${key}. Install it on the repo and try again.`, { cause: e })
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

// The app's webhook state on GitHub, for the settings checklist: whether the
// webhook URL points somewhere, which events the app is subscribed to and
// whether it has the Issues permission. Events/permissions can't be changed via
// the API, so the card can only report them and point at the app settings.
export async function getAppWebhookState() {
  const octokit = getApp().octokit
  // Apps created without a webhook (the manifest omitted hook_attributes) 404
  // on the hook config until one is set: that's "not configured", not an error.
  const [{ data: app }, hook] = await Promise.all([
    octokit.rest.apps.getAuthenticated(),
    octokit.rest.apps.getWebhookConfigForApp().catch((e: { status?: number }) => {
      if (e.status === 404) return null
      throw e
    }),
  ])
  return {
    url: hook?.data.url ?? null,
    events: app?.events ?? [],
    issuesPermission: (app?.permissions as Record<string, string> | undefined)?.issues != null,
  }
}

// Every repo the app is installed on, across all installations: the source for
// the "connect a repo" picker.
export async function listAppRepositories() {
  const repos = []
  for await (const { repository } of getApp().eachRepository.iterator()) {
    repos.push(repository)
  }
  return repos
}

// The repo's branch names, for the branch pickers (setup modal, run branch).
export async function listRepoBranches(owner: string, repo: string): Promise<string[]> {
  const octokit = await getInstallationClient(owner, repo)
  const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
    owner,
    repo,
    per_page: 100,
  })
  return branches.map(b => b.name)
}

// The identity commits should carry so GitHub links them to the app's bot
// account (avatar + profile): `<slug>[bot]` with the bot user's noreply
// address, which needs the bot's numeric user id (one extra lookup, cached).
// Null when it can't be resolved: callers fall back to a placeholder identity.
let cachedBotIdentity: { name: string, email: string } | null = null

export async function getBotIdentity(): Promise<{ name: string, email: string } | null> {
  if (cachedBotIdentity) return cachedBotIdentity
  try {
    const octokit = getApp().octokit
    const { data: app } = await octokit.rest.apps.getAuthenticated()
    if (!app?.slug) return null
    const login = `${app.slug}[bot]`
    // The app JWT may only call /app/* endpoints (users.getByUsername 403s),
    // so the bot user's numeric id comes from the PUBLIC users endpoint,
    // unauthenticated. One call per boot: the identity is cached.
    const user = await $fetch<{ id: number }>(`https://api.github.com/users/${encodeURIComponent(login)}`)
    cachedBotIdentity = { name: login, email: `${user.id}+${login}@users.noreply.github.com` }
    return cachedBotIdentity
  }
  catch (e) {
    console.warn(`Could not resolve the GitHub App bot identity (commits fall back to a generic one): ${(e as Error).message}`)
    return null
  }
}

// Open a pull request as the app. Returns null when there is no diff to open a
// PR for (e.g. an empty agent run committed nothing): a skip, not a failure.
export async function createPullRequest(
  owner: string,
  repo: string,
  params: { title: string, body: string, head: string, base: string },
): Promise<{ url: string, number: number } | null> {
  const octokit = await getInstallationClient(owner, repo)
  try {
    const { data } = await octokit.rest.pulls.create({ owner, repo, ...params })
    return { url: data.html_url, number: data.number }
  }
  catch (e) {
    if (/No commits between/i.test((e as Error).message)) return null
    throw e
  }
}
