import type { Octokit } from 'octokit'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { DdevEnv, Project } from '../db/schema'
import { fetchDdevConfig, fetchFavicon, fetchFrameworkVersion, fetchPackageManager } from './github'
import { getInstallationClient } from './github-app'

export interface ProjectMeta {
  framework: string | null
  frameworkVersion: string | null
  ddevEnv: DdevEnv
  favicon: string
}

// Resolve a project's framework + version + DDEV environment spec + favicon
// from its repo (`.ddev/config.yaml`, `composer.lock`, `package.json`, the
// tree). Returns null when the repo definitely has no `.ddev/config.yaml` on
// the ref (the project can never boot); throws when the repo can't be read at
// all. Within a readable repo every field is best-effort: nulls when a file
// is missing, the favicon '' ("looked, none found"), which the preview
// fallback (utils/favicon.ts) may fill later.
export async function resolveProjectMeta(
  octokit: Octokit,
  owner: string,
  name: string,
  ref?: string,
): Promise<ProjectMeta | null> {
  const cfg = await fetchDdevConfig(octokit, owner, name, ref)
  if (!cfg) return null
  const [frameworkVersion, packageManager, favicon] = await Promise.all([
    cfg.type ? fetchFrameworkVersion(octokit, owner, name, cfg.type, ref) : Promise.resolve(null),
    fetchPackageManager(octokit, owner, name, ref),
    fetchFavicon(octokit, owner, name, ref),
  ])
  return {
    framework: cfg.type,
    frameworkVersion,
    favicon: favicon ?? '',
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

// Projects whose resolution failed or stayed unresolved recently. Without this,
// a repo that legitimately has no `.ddev/config.yaml` (or is unreadable) would
// re-trigger 3-4 GitHub calls on EVERY projects page load, blocking SSR.
const attemptedAt = new Map<number, number>()
const RETRY_MS = 10 * 60_000

// Resolve missing framework/environment metadata from each repo and persist it,
// mutating the passed rows in place. Best-effort: if the GitHub App isn't
// configured/installed or a repo can't be read, the affected projects keep their
// nulls and the caller renders them without the data. Re-attempts an unresolved
// project at most every RETRY_MS.
export async function backfillFrameworks(projects: Project[]): Promise<void> {
  const now = Date.now()
  const missing = projects.filter(p =>
    (p.framework == null || p.ddevEnv == null || p.favicon == null)
    && now - (attemptedAt.get(p.id) ?? 0) > RETRY_MS)
  if (!missing.length) return

  await Promise.all(missing.map(async (p) => {
    attemptedAt.set(p.id, now)
    try {
      const octokit = await getInstallationClient(p.owner, p.name)
      const meta = await resolveProjectMeta(octokit, p.owner, p.name, p.defaultBranch)
      // No `.ddev/config.yaml` (anymore): nothing to resolve from; the next
      // attempt happens after the retry window.
      if (!meta) return
      // A favicon already on the row wins: the preview fallback
      // (utils/favicon.ts) may have stored one the repo scan can't find, and
      // a re-resolve must not revert it to ''.
      const patch = { ...meta, favicon: p.favicon || meta.favicon }
      db.update(schema.projects)
        .set(patch)
        .where(eq(schema.projects.id, p.id))
        .run()
      Object.assign(p, patch)
      if (meta.framework != null) attemptedAt.delete(p.id)
    }
    catch {
      // App not configured/installed or repo unreadable: keep nulls; the next
      // attempt happens after the retry window.
    }
  }))
}
