import { listAppRepositories } from '../../utils/github-app'

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
