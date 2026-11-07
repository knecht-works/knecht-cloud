import type { Project } from '../db/schema'
import type { ProjectMeta } from '../utils/framework'
import type { RepoProvider } from '../../shared/utils/integrations'

export type GitRepo = Pick<Project, 'repoProvider' | 'owner' | 'name' | 'fullName'>

export interface GitCredentials {
  cloneUrl: string
  username: string
  token: string
}

export interface PullRequest {
  url: string
  number: number
  existing: boolean
}

export interface RemoteRepo {
  repoId: string
  owner: string
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  description: string | null
}

export interface GitProvider {
  id: RepoProvider
  credentials(repo: GitRepo): Promise<GitCredentials>
  repoUrl(repo: GitRepo): string
  branchUrl(repo: GitRepo, branch: string): string
  listRepos(): Promise<RemoteRepo[]>
  listBranches(repo: GitRepo): Promise<string[]>
  listLabels(repo: GitRepo): Promise<string[]>
  listAssignees(repo: GitRepo): Promise<string[]>
  // null when the branch has no commits over the base.
  createPullRequest(repo: GitRepo, params: { head: string, base: string, title: string, body: string }): Promise<PullRequest | null>
  projectMeta(repo: GitRepo, ref?: string): Promise<ProjectMeta>
}
