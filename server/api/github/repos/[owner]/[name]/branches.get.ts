import { getInstallationClient } from '../../../../../utils/github-app'

// GET /api/github/repos/:owner/:name/branches → the repo's branch names, for
// the branch picker in the project setup (the connected branch is what runs
// check out and open PRs against).
export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner')
  const name = getRouterParam(event, 'name')
  if (!owner || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid repo' })
  }

  const octokit = await getInstallationClient(owner, name)
  const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
    owner,
    repo: name,
    per_page: 100,
  })
  return branches.map(b => b.name)
})
