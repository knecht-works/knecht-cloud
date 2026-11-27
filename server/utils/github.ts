import type { Octokit } from 'octokit'
import { ENV_DETECT_FILES, type ReadFile } from '#server/utils/env-detect'

// A file over 1 MB comes back without inline content and reads as '': it
// exists, which is all a lockfile has to say.
async function readRepoFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref })
  if (Array.isArray(data) || data.type !== 'file') return null
  if (!('content' in data) || !data.content) return ''
  return Buffer.from(data.content, 'base64').toString('utf8')
}

export async function readRepoDir(
  octokit: Octokit,
  owner: string,
  repo: string,
  dir: string,
  ref?: string,
): Promise<Record<string, string>> {
  let entries: unknown
  try {
    entries = (await octokit.rest.repos.getContent({ owner, repo, path: dir, ref })).data
  }
  catch (e) {
    if ((e as { status?: number }).status === 404) return {}
    throw e
  }
  if (!Array.isArray(entries)) return {}
  const files = (entries as { type: string, name: string, path: string }[]).filter(e => e.type === 'file')
  return Object.fromEntries(await Promise.all(files.map(async f => [f.name, await readRepoFile(octokit, owner, repo, f.path, ref) ?? ''])))
}

export async function repoReader(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref?: string,
): Promise<ReadFile> {
  const files = new Map(await Promise.all(ENV_DETECT_FILES.map(async (path): Promise<[string, string | null]> => {
    try {
      return [path, await readRepoFile(octokit, owner, repo, path, ref)]
    }
    catch (e) {
      if ((e as { status?: number }).status === 404) return [path, null]
      throw e
    }
  })))
  return path => files.get(path) ?? null
}

export async function fetchPackageManager(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref?: string,
): Promise<string | null> {
  try {
    const content = await readRepoFile(octokit, owner, repo, 'package.json', ref)
    if (content === null) return null
    const pkg = JSON.parse(content) as { packageManager?: string }
    return pkg.packageManager ?? null
  }
  catch {
    return null
  }
}

export async function fetchFrameworkVersion(
  octokit: Octokit,
  owner: string,
  repo: string,
  pkg: string,
  ref?: string,
): Promise<string | null> {
  try {
    const content = await readRepoFile(octokit, owner, repo, 'composer.lock', ref)
    if (content === null) return null
    const lock = JSON.parse(content) as {
      packages?: { name: string, version: string }[]
    }
    const found = lock.packages?.find(p => p.name === pkg)
    if (!found) return null
    return found.version.replace(/^v/, '').match(/^\d+\.\d+(?:\.\d+)?/)?.[0] ?? null
  }
  catch {
    return null
  }
}
