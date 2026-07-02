import { listAppRepositories } from '../../utils/github-app'

// GET /api/github/repos → the repos the GitHub App is installed on, for the
// "connect a repo" picker. Most-recently-updated first. An empty list means the
// app has no installations yet (or none granting repo access).
export default defineEventHandler(async () => {
  const repos = await listAppRepositories()

  return repos
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    .map(r => ({
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
