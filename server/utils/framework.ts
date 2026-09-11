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

const attemptedAt = new Map<number, number>()
const RETRY_MS = 10 * 60_000

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
      const patch = { ...meta, favicon: p.favicon || meta.favicon }
      db.update(schema.projects)
        .set(patch)
        .where(eq(schema.projects.id, p.id))
        .run()
      Object.assign(p, patch)
      attemptedAt.delete(p.id)
    }
    catch {
      // Retried after the window.
    }
  }))
}
