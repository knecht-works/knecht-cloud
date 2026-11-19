import { GIT_PROVIDERS } from '../../git'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async () => {
  const repos = await GIT_PROVIDERS.github.listRepos()
  return repos.map(r => ({ repoProvider: 'github' as const, ...r }))
})
