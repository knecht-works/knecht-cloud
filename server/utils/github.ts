import type { H3Event } from 'h3'
import { Octokit } from 'octokit'

// Build an Octokit client from the logged-in user's OAuth token. The token came
// from the GitHub login (repo scope) and doubles as the clone/PR credential
// (internals/docs/tech-stack.md §3).
export async function getGithubClient(event: H3Event): Promise<Octokit> {
  const { secure } = await requireUserSession(event)
  if (!secure?.githubToken) {
    throw createError({ statusCode: 401, statusMessage: 'No GitHub token in session' })
  }
  return new Octokit({ auth: secure.githubToken })
}
