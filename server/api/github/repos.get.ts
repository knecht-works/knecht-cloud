// GET /api/github/repos → the logged-in user's repositories, for the
// "connect a repo" picker. Most-recently-updated first.
export default defineEventHandler(async (event) => {
  const octokit = await getGithubClient(event)

  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    per_page: 100,
    sort: 'updated',
    affiliation: 'owner,collaborator,organization_member',
  })

  return data.map(r => ({
    githubId: r.id,
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    cloneUrl: r.clone_url,
    description: r.description,
  }))
})
