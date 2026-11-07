import { GIT_PROVIDERS } from '../../git'

export default defineEventHandler(async () => {
  const repos = await GIT_PROVIDERS.github.listRepos()
  return repos.map(r => ({ repoProvider: 'github' as const, ...r }))
})
