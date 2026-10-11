import type { Octokit } from 'octokit'
import semver from 'semver'
import { FRAMEWORKS } from '../../shared/utils/frameworks'
import type { DdevEnv, Project } from '../db/schema'
import { setProjectMeta } from '../stores/projects'
import { detectEnv, parseDdevConfig, repoShipsDdevConfig, type ReadFile } from './env-detect'
import { fetchFavicon, fetchFrameworkVersion, fetchPackageManager, repoReader } from './github'
import { getInstallationClient } from './github-app'

export interface ProjectMeta {
  framework: string | null
  frameworkVersion: string | null
  ddevEnv: DdevEnv
  favicon: string
}

interface DetectedFramework {
  id: string
  composer?: string
  npmRange?: string
}

function readDeps(read: ReadFile, path: string, keys: string[]): Record<string, unknown> {
  const text = read(path)
  if (!text) return {}
  try {
    const json = JSON.parse(text) as Record<string, Record<string, unknown> | undefined>
    return Object.assign({}, ...keys.map(k => json[k] ?? {}))
  }
  catch {
    return {}
  }
}

export function detectFramework(read: ReadFile): DetectedFramework | null {
  const composer = readDeps(read, 'composer.json', ['require'])
  const npm = readDeps(read, 'package.json', ['dependencies', 'devDependencies'])
  for (const fw of FRAMEWORKS) {
    const composerPkg = fw.composer?.find(p => p in composer)
    if (composerPkg) return { id: fw.id, composer: composerPkg }
    const npmPkg = fw.npm?.find(p => p in npm)
    if (npmPkg) return { id: fw.id, npmRange: String(npm[npmPkg]) }
  }
  return null
}

function npmVersion(range: string): string | null {
  const v = semver.validRange(range) ? semver.minVersion(range) : null
  return v ? `${v.major}.${v.minor}` : null
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
  const framework = detectFramework(read)
  const [frameworkVersion, packageManager, favicon] = await Promise.all([
    framework?.composer
      ? fetchFrameworkVersion(octokit, owner, name, framework.composer, ref)
      : Promise.resolve(framework?.npmRange ? npmVersion(framework.npmRange) : null),
    fetchPackageManager(octokit, owner, name, ref),
    fetchFavicon(octokit, owner, name, ref),
  ])
  return {
    framework: framework?.id ?? cfg?.type ?? null,
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
      setProjectMeta(p.id, patch)
      Object.assign(p, patch)
      attemptedAt.delete(p.id)
    }
    catch {
      // Retried after the window.
    }
  }))
}
