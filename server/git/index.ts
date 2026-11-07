import type { RepoProvider } from '../../shared/utils/integrations'
import type { GitProvider, GitRepo } from './types'
import { githubProvider } from './github'

export const GIT_PROVIDERS: Record<RepoProvider, GitProvider> = {
  github: githubProvider,
}

export function gitProvider(repo: GitRepo): GitProvider {
  return GIT_PROVIDERS[repo.repoProvider]
}
