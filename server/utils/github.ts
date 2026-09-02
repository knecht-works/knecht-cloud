import type { Octokit } from 'octokit'
import { ENV_DETECT_FILES, type ReadFile } from './env-detect'
import { FAVICON_MAX_BYTES, FAVICON_MIME_BY_EXT } from './favicon'

// A repo file's text content via the contents API. Returns null when the path
// isn't a file or the response has no inline content; throws when the file is
// missing (callers catch, matching the getContent 404).
async function readRepoFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref })
  if (Array.isArray(data) || data.type !== 'file' || !('content' in data) || !data.content) return null
  return Buffer.from(data.content, 'base64').toString('utf8')
}

// A `ReadFile` (utils/env-detect.ts) over a repo ref: the files detection
// may look at are fetched up front, concurrently, so detectEnv stays
// synchronous and runs the same code as on a checkout. Missing files read as
// null; every other failure (App not installed, rate limit, network)
// rejects, so callers can tell "couldn't look" from "the repo has none".
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

// The Corepack `packageManager` field from a repo's `package.json` (e.g.
// 'pnpm@9.1.0'). Best-effort: null when there's no package.json or no field.
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

// The repo's favicon as a data URI. One recursive tree listing finds any
// favicon.svg/png/ico wherever it lives (docroot, public/, a theme folder),
// so the lookup doesn't depend on knowing the docroot. Best-effort: null when
// the repo has no such file, the tree can't be read (or is truncated past the
// file), or every candidate is oversized (FAVICON_MAX_BYTES, shared with the
// preview fallback in utils/favicon.ts).
export async function fetchFavicon(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref?: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref ?? 'HEAD',
      recursive: 'true',
    })
    const candidates = (data.tree ?? [])
      .map(e => ({ ...e, match: /(?:^|\/)favicon\.(svg|png|ico)$/i.exec(e.path ?? '') }))
      .filter(e => e.type === 'blob' && e.sha && e.match
        && !/(?:^|\/)(?:node_modules|vendor)\//.test(e.path!))
    // Shallower beats deeper (the site's own icon over some sub-package's);
    // at equal depth svg > png > ico (renders sharpest).
    const order = ['svg', 'png', 'ico']
    candidates.sort((a, b) =>
      (a.path!.split('/').length - b.path!.split('/').length)
      || (order.indexOf(a.match![1]!.toLowerCase()) - order.indexOf(b.match![1]!.toLowerCase())))
    const best = candidates.find(c => (c.size ?? 0) <= FAVICON_MAX_BYTES)
    if (!best) return null
    const blob = await octokit.rest.git.getBlob({ owner, repo, file_sha: best.sha! })
    if (!blob.data.content) return null
    const mime = FAVICON_MIME_BY_EXT[best.match![1]!.toLowerCase()]!
    return `data:${mime};base64,${blob.data.content.replace(/\s/g, '')}`
  }
  catch {
    return null
  }
}

// The composer package that carries the framework's version, per DDEV type.
const COMPOSER_PACKAGE: Record<string, string> = {
  typo3: 'typo3/cms-core',
  craftcms: 'craftcms/cms',
  shopware6: 'shopware/core',
  laravel: 'laravel/framework',
  magento2: 'magento/product-community-edition',
  silverstripe: 'silverstripe/framework',
}

function composerPackageFor(type: string): string | null {
  const t = type.toLowerCase()
  if (t.startsWith('drupal')) return 'drupal/core'
  return COMPOSER_PACKAGE[t] ?? null
}

// The framework's major.minor version (e.g. '13.4') read from the matching
// package in the repo's composer.lock. Best-effort: returns null when the
// framework isn't composer-versioned (e.g. plain WordPress), the lock is
// missing/too large to inline, or the version isn't a plain release.
export async function fetchFrameworkVersion(
  octokit: Octokit,
  owner: string,
  repo: string,
  type: string,
  ref?: string,
): Promise<string | null> {
  const pkg = composerPackageFor(type)
  if (!pkg) return null
  try {
    const content = await readRepoFile(octokit, owner, repo, 'composer.lock', ref)
    if (content === null) return null
    const lock = JSON.parse(content) as {
      packages?: { name: string, version: string }[]
    }
    const found = lock.packages?.find(p => p.name === pkg)
    if (!found) return null
    const m = found.version.replace(/^v/, '').match(/^(\d+)\.(\d+)/)
    return m ? `${m[1]}.${m[2]}` : null
  }
  catch {
    return null
  }
}
