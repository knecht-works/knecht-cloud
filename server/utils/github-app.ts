import type { Octokit } from 'octokit'
import { App } from 'octokit'
import { githubAppCredentials } from './github-credentials'
import { formatObjectContext } from './object-context'

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

export async function getIssueContext(owner: string, repo: string, issueNumber: number): Promise<string> {
  const octokit = await getInstallationClient(owner, repo)
  const { data: issue } = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber })
  const comments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: issueNumber, per_page: 100 })
  return formatObjectContext({
    heading: `${issue.pull_request ? 'Pull request' : 'Issue'} #${issue.number}: ${issue.title}`,
    url: issue.html_url,
    facts: [
      ['State', issue.state],
      ['Author', issue.user?.login ?? ''],
      ['Assignees', (issue.assignees ?? []).map(a => a.login).join(', ')],
      ['Labels', issue.labels.map(l => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean).join(', ')],
    ],
    body: issue.body ?? '',
    comments: comments.map(c => ({ author: c.user?.login ?? 'unknown', at: new Date(c.created_at), body: c.body ?? '' })),
  })
}

export async function listRepoLabels(owner: string, repo: string): Promise<string[]> {
  const octokit = await getInstallationClient(owner, repo)
  const labels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, { owner, repo, per_page: 100 })
  return labels.map(l => l.name)
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
