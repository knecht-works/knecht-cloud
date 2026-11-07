import { resolveProjectMeta } from '../utils/framework'
import { createPullRequest, getInstallationClient, getInstallationToken, listRepoBranches } from '../utils/github-app'
import type { GitProvider } from './types'

export const githubProvider: GitProvider = {
  id: 'github',

  async credentials(repo) {
    return {
      cloneUrl: `https://github.com/${repo.fullName}.git`,
      username: 'x-access-token',
      token: await getInstallationToken(repo.owner, repo.name),
    }
  },

  repoUrl: repo => `https://github.com/${repo.fullName}`,
  branchUrl: (repo, branch) => `https://github.com/${repo.fullName}/tree/${branch}`,
  listBranches: repo => listRepoBranches(repo.owner, repo.name),
  createPullRequest: (repo, params) => createPullRequest(repo.owner, repo.name, params),

  async projectMeta(repo, ref) {
    return resolveProjectMeta(await getInstallationClient(repo.owner, repo.name), repo.owner, repo.name, ref)
  },
}
