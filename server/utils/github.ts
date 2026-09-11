import type { Octokit } from 'octokit'
import { ENV_DETECT_FILES, type ReadFile } from './env-detect'
import { FAVICON_MAX_BYTES, FAVICON_MIME_BY_EXT } from './favicon'

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
