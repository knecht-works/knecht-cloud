import type { Project } from '../db/schema'
import type { ProjectMeta } from '../utils/framework'

export type GitRepo = Pick<Project, 'owner' | 'name' | 'fullName'>

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

export interface GitProvider {
  id: string
  credentials(repo: GitRepo): Promise<GitCredentials>
  repoUrl(repo: GitRepo): string
  branchUrl(repo: GitRepo, branch: string): string
  listBranches(repo: GitRepo): Promise<string[]>
  // null when the branch has no commits over the base.
  createPullRequest(repo: GitRepo, params: { head: string, base: string, title: string, body: string }): Promise<PullRequest | null>
  projectMeta(repo: GitRepo, ref?: string): Promise<ProjectMeta>
}
