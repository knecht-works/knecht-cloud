import type { H3Event } from 'h3'
import type { Octokit } from 'octokit'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { DdevEnv, Project } from '../db/schema'
import { fetchDdevConfig, fetchFrameworkVersion, fetchPackageManager, getGithubClient } from './github'

export interface ProjectMeta {
  framework: string | null
  frameworkVersion: string | null
  ddevEnv: DdevEnv
}

// Resolve a project's framework + version + DDEV environment spec from its repo
// (`.ddev/config.yaml`, `composer.lock`, `package.json`). Best-effort: every
// field falls back to null when the repo/files can't be read.
export async function resolveProjectMeta(
  octokit: Octokit,
  owner: string,
  name: string,
  ref?: string,
): Promise<ProjectMeta> {
  const cfg = await fetchDdevConfig(octokit, owner, name, ref)
  const [frameworkVersion, packageManager] = await Promise.all([
    cfg.type ? fetchFrameworkVersion(octokit, owner, name, cfg.type, ref) : Promise.resolve(null),
    fetchPackageManager(octokit, owner, name, ref),
  ])
  return {
    framework: cfg.type,
    frameworkVersion,
    ddevEnv: {
      webserver: cfg.webserver,
      phpVersion: cfg.phpVersion,
      dbType: cfg.dbType,
      dbVersion: cfg.dbVersion,
      nodeVersion: cfg.nodeVersion,
      packageManager,
    },
  }
}

// Resolve missing framework/environment metadata from each repo and persist it,
// mutating the passed rows in place. Best-effort: if there's no session/token or
// a repo can't be read, the affected projects keep their nulls and the caller
// renders them without the data. Re-runs while `framework` is still unresolved.
export async function backfillFrameworks(event: H3Event, projects: Project[]): Promise<void> {
  const missing = projects.filter(p => p.framework == null || p.ddevEnv == null)
  if (!missing.length) return

  let octokit
  try {
    octokit = await getGithubClient(event)
  }
  catch {
    return
  }

  await Promise.all(missing.map(async (p) => {
    const meta = await resolveProjectMeta(octokit, p.owner, p.name, p.defaultBranch)
    db.update(schema.projects)
      .set(meta)
      .where(eq(schema.projects.id, p.id))
      .run()
    Object.assign(p, meta)
  }))
}
