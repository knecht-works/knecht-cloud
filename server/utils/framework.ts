import type { Octokit } from 'octokit'
import semver from 'semver'
import { FRAMEWORKS } from '#shared/utils/frameworks'
import type { DdevEnv, Project } from '#server/db/schema'
import { setProjectMeta } from '#server/stores/projects'
import { detectEnv, parseDdevConfig, repoShipsDdevConfig, type ReadFile } from '#server/utils/env-detect'
import { fetchFrameworkVersion, fetchPackageManager, repoReader } from '#server/utils/github'
import { gitProvider } from '#server/git'

export interface ProjectMeta {
  framework: string | null
  frameworkVersion: string | null
  ddevEnv: DdevEnv
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
  const [frameworkVersion, packageManager] = await Promise.all([
    framework?.composer
      ? fetchFrameworkVersion(octokit, owner, name, framework.composer, ref)
      : Promise.resolve(framework?.npmRange ? npmVersion(framework.npmRange) : null),
    fetchPackageManager(octokit, owner, name, ref),
  ])
  return {
    framework: framework?.id ?? cfg?.type ?? null,
    frameworkVersion,
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
    p.ddevEnv == null
    && now - (attemptedAt.get(p.id) ?? 0) > RETRY_MS)
  if (!missing.length) return

  await Promise.all(missing.map(async (p) => {
    attemptedAt.set(p.id, now)
    try {
      const meta = await gitProvider(p).projectMeta(p, p.defaultBranch)
      setProjectMeta(p.id, meta)
      Object.assign(p, meta)
      attemptedAt.delete(p.id)
    }
    catch {
      // Retried after the window.
    }
  }))
}

// A run checking out the default branch is the moment an upgrade is known to have landed.
export async function refreshFramework(project: Project): Promise<void> {
  const { framework, frameworkVersion } = await gitProvider(project).projectMeta(project, project.defaultBranch)
  if (framework === project.framework && frameworkVersion === project.frameworkVersion) return
  setProjectMeta(project.id, { framework, frameworkVersion })
}
