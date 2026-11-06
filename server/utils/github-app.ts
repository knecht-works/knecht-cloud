import type { Octokit } from 'octokit'
import { App } from 'octokit'
import { githubAppCredentials } from './github-credentials'
import { ofetch } from 'ofetch'

let cachedApp: App | null = null
let cachedForAppId: string | null = null

function getApp(): App {
  const creds = githubAppCredentials()
  if (!creds) {
    throw new Error(
      'GitHub App not configured. Open the dashboard and complete the GitHub App setup.',
    )
  }
  if (cachedApp && cachedForAppId === creds.appId) return cachedApp
  cachedApp = new App({ appId: creds.appId, privateKey: creds.privateKey })
  cachedForAppId = creds.appId
  return cachedApp
}

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

export async function getInstallationClient(owner: string, repo: string): Promise<Octokit> {
  return getApp().getInstallationOctokit(await getInstallationId(owner, repo))
}

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

export async function listAppRepositories() {
  const repos = []
  for await (const { repository } of getApp().eachRepository.iterator()) {
    repos.push(repository)
  }
  return repos
}

export async function listRepoBranches(owner: string, repo: string): Promise<string[]> {
  const octokit = await getInstallationClient(owner, repo)
  const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
    owner,
    repo,
    per_page: 100,
  })
  return branches.map(b => b.name)
}

// `<slug>[bot]` with the bot's noreply address is what makes GitHub link
// commits to the app's avatar and profile.
let cachedBotIdentity: { name: string, email: string } | null = null

export async function getBotIdentity(): Promise<{ name: string, email: string } | null> {
  if (cachedBotIdentity) return cachedBotIdentity
  try {
    const octokit = getApp().octokit
    const { data: app } = await octokit.rest.apps.getAuthenticated()
    if (!app?.slug) return null
    const login = `${app.slug}[bot]`
    // The app JWT may only call /app/* (users.getByUsername 403s), so the bot's
    // numeric id comes from the public users endpoint, unauthenticated.
    const user = await $fetch<{ id: number }>(`https://api.github.com/users/${encodeURIComponent(login)}`)
    cachedBotIdentity = { name: login, email: `${user.id}+${login}@users.noreply.github.com` }
    return cachedBotIdentity
  }
  catch (e) {
    console.warn(`Could not resolve the GitHub App bot identity (commits fall back to a generic one): ${(e as Error).message}`)
    return null
  }
}

export async function createIssueComment(owner: string, repo: string, issueNumber: number, body: string): Promise<{ url: string }> {
  const octokit = await getInstallationClient(owner, repo)
  const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body })
  return { url: data.html_url }
}

export interface GithubIssueSnapshot {
  issue: Awaited<ReturnType<Octokit['rest']['issues']['get']>>['data']
  comments: Awaited<ReturnType<Octokit['rest']['issues']['listComments']>>['data']
  pull: Awaited<ReturnType<Octokit['rest']['pulls']['get']>>['data'] | null
  reviews: Awaited<ReturnType<Octokit['rest']['pulls']['listReviews']>>['data']
  reviewComments: Awaited<ReturnType<Octokit['rest']['pulls']['listReviewComments']>>['data']
  parent: { number: number, title: string } | null
  subIssues: { number: number, title: string }[]
}

// The full media type adds body_html, where GitHub signs the links of images in private repositories.
export async function getIssueSnapshot(owner: string, repo: string, issueNumber: number): Promise<GithubIssueSnapshot> {
  const octokit = await getInstallationClient(owner, repo)
  const full = { mediaType: { format: 'full' } }
  const { data: issue } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber, ...full })
  const isPull = !!issue.pull_request
  const [comments, pull, reviews, reviewComments, parent, subIssues] = await Promise.all([
    octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: issueNumber, per_page: 100, ...full }),
    isPull ? octokit.rest.pulls.get({ owner, repo, pull_number: issueNumber, ...full }).then(r => r.data) : null,
    isPull ? octokit.paginate(octokit.rest.pulls.listReviews, { owner, repo, pull_number: issueNumber, per_page: 100, ...full }) : [],
    isPull ? octokit.paginate(octokit.rest.pulls.listReviewComments, { owner, repo, pull_number: issueNumber, per_page: 100, ...full }) : [],
    octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/parent', { owner, repo, issue_number: issueNumber })
      .then(r => ({ number: r.data.number as number, title: r.data.title as string }), () => null),
    octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues', { owner, repo, issue_number: issueNumber, per_page: 100 })
      .then(r => (r.data as { number: number, title: string }[]).map(i => ({ number: i.number, title: i.title })), () => []),
  ])
  return { issue, comments, pull, reviews, reviewComments, parent, subIssues }
}

// Signed or public links: the installation token must not go along.
export async function downloadGithubUpload(url: string): Promise<Buffer> {
  return Buffer.from(await ofetch<ArrayBuffer, 'arrayBuffer'>(url, { responseType: 'arrayBuffer', timeout: 60_000 }))
}

export async function listRepoLabels(owner: string, repo: string): Promise<string[]> {
  const octokit = await getInstallationClient(owner, repo)
  const labels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, { owner, repo, per_page: 100 })
  return labels.map(l => l.name)
}

export async function listRepoAssignees(owner: string, repo: string): Promise<string[]> {
  const octokit = await getInstallationClient(owner, repo)
  const users = await octokit.paginate(octokit.rest.issues.listAssignees, { owner, repo, per_page: 100 })
  return users.map(u => u.login)
}

export async function addIssueLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void> {
  const octokit = await getInstallationClient(owner, repo)
  await octokit.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels })
}

export async function removeIssueLabel(owner: string, repo: string, issueNumber: number, label: string): Promise<void> {
  const octokit = await getInstallationClient(owner, repo)
  try {
    await octokit.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: label })
  }
  catch (e) {
    if ((e as { status?: number }).status !== 404) throw e
  }
}

export async function addCommentReaction(owner: string, repo: string, commentId: number, reaction: 'eyes' | '+1'): Promise<void> {
  const octokit = await getInstallationClient(owner, repo)
  await octokit.rest.reactions.createForIssueComment({ owner, repo, comment_id: commentId, content: reaction })
}

export async function createPullRequest(
  owner: string,
  repo: string,
  params: { title: string, body: string, head: string, base: string },
): Promise<{ url: string, number: number, existing: boolean } | null> {
  const octokit = await getInstallationClient(owner, repo)
  try {
    const { data } = await octokit.rest.pulls.create({ owner, repo, ...params })
    return { url: data.html_url, number: data.number, existing: false }
  }
  catch (e) {
    if (/No commits between/i.test((e as Error).message)) return null
    if (!/A pull request already exists/i.test((e as Error).message)) throw e
    const { data } = await octokit.rest.pulls.list({ owner, repo, head: `${owner}:${params.head}`, state: 'open' })
    if (!data[0]) throw e
    return { url: data[0].html_url, number: data[0].number, existing: true }
  }
}
