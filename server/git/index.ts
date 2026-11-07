import type { GitProvider, GitRepo } from './types'
import { githubProvider } from './github'

export function gitProvider(_repo: GitRepo): GitProvider {
  return githubProvider
}
