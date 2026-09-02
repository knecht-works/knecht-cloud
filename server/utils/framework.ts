import type { Octokit } from 'octokit'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { DdevEnv, Project } from '../db/schema'
import { detectEnv, parseDdevConfig, repoShipsDdevConfig } from './env-detect'
import { fetchFavicon, fetchFrameworkVersion, fetchPackageManager, repoReader } from './github'
import { getInstallationClient } from './github-app'

export interface ProjectMeta {
  framework: string | null
  frameworkVersion: string | null
  ddevEnv: DdevEnv
  favicon: string
}

// Resolve a project's framework + version + environment spec + favicon from
// its repo. The environment is the same detection the boot runs on the
// checkout (utils/env-detect.ts), over the repo's files at `ref`: a repo with
// its own `.ddev/config.yaml` is described by it (framework from its type),
// any other repo by what composer.json/.nvmrc and friends say. Throws when
// the repo can't be read at all. Within a readable repo every field is
// best-effort: nulls when a file is missing, the favicon '' ("looked, none
// found"), which the preview fallback (utils/favicon.ts) may fill later.
export async function resolveProjectMeta(
  octokit: Octokit,
  owner: string,
  name: string,
  ref?: string,
): Promise<ProjectMeta> {
  const read = await repoReader(octokit, owner, name, ref)
  const detected = detectEnv(read)
  const ddevText = read('.ddev/config.yaml')
  const cfg = repoShipsDdevConfig(ddevText) ? parseDdevConfig(ddevText) : null
  const [frameworkVersion, packageManager, favicon] = await Promise.all([
    cfg?.type ? fetchFrameworkVersion(octokit, owner, name, cfg.type, ref) : Promise.resolve(null),
    fetchPackageManager(octokit, owner, name, ref),
    fetchFavicon(octokit, owner, name, ref),
  ])
  return {
    framework: cfg?.type ?? null,
    frameworkVersion,
    favicon: favicon ?? '',
    ddevEnv: {
      webserver: cfg?.webserver ?? null,
      phpVersion: detected.fields.phpVersion?.value ?? null,
      dbType: cfg?.dbType ?? null,
      dbVersion: cfg?.dbVersion ?? null,
      nodeVersion: detected.fields.nodeVersion?.value ?? null,
      packageManager,
      detected,
    },
  }
}

// Projects whose resolution failed recently. Without this, an unreadable repo
// would re-trigger the GitHub calls on EVERY projects page load, blocking SSR.
const attemptedAt = new Map<number, number>()
const RETRY_MS = 10 * 60_000

// Resolve missing environment metadata from each repo and persist it,
// mutating the passed rows in place. A resolved environment (ddevEnv) marks
// a project as done: the framework legitimately stays null for a repo
// without a ddev config. Best-effort: if the GitHub App isn't
// configured/installed or a repo can't be read, the affected projects keep
// their nulls and the caller renders them without the data. Re-attempts an
// unresolved project at most every RETRY_MS.
export async function backfillFrameworks(projects: Project[]): Promise<void> {
  const now = Date.now()
  const missing = projects.filter(p =>
    (p.ddevEnv == null || p.favicon == null)
    && now - (attemptedAt.get(p.id) ?? 0) > RETRY_MS)
  if (!missing.length) return

  await Promise.all(missing.map(async (p) => {
    attemptedAt.set(p.id, now)
    try {
      const octokit = await getInstallationClient(p.owner, p.name)
      const meta = await resolveProjectMeta(octokit, p.owner, p.name, p.defaultBranch)
      // A favicon already on the row wins: the preview fallback
      // (utils/favicon.ts) may have stored one the repo scan can't find, and
      // a re-resolve must not revert it to ''.
      const patch = { ...meta, favicon: p.favicon || meta.favicon }
      db.update(schema.projects)
        .set(patch)
        .where(eq(schema.projects.id, p.id))
        .run()
      Object.assign(p, patch)
      attemptedAt.delete(p.id)
    }
    catch {
      // App not configured/installed or repo unreadable: keep nulls; the next
      // attempt happens after the retry window.
    }
  }))
}
