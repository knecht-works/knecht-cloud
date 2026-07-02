import type { Octokit } from 'octokit'
import { parse } from 'yaml'

// The DDEV project type + environment spec parsed from a repo's
// `.ddev/config.yaml` (https://docs.ddev.com/en/stable/users/configuration/config/).
// `type` is the framework (e.g. 'typo3', 'wordpress', 'craftcms'). Best-effort:
// every field is null if the file/repo can't be read.
export interface DdevConfig {
  type: string | null
  webserver: string | null
  phpVersion: string | null
  dbType: string | null
  dbVersion: string | null
  nodeVersion: string | null
}

const EMPTY_DDEV_CONFIG: DdevConfig = {
  type: null,
  webserver: null,
  phpVersion: null,
  dbType: null,
  dbVersion: null,
  nodeVersion: null,
}

// DDEV applies its config defaults when a field is omitted; the only one we can
// safely assume is the webserver (nginx-fpm). The rest stay null when absent.
const str = (v: unknown): string | null => (v == null ? null : String(v))

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

export async function fetchDdevConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref?: string,
): Promise<DdevConfig> {
  try {
    const content = await readRepoFile(octokit, owner, repo, '.ddev/config.yaml', ref)
    if (content === null) return EMPTY_DDEV_CONFIG
    const cfg = parse(content) as {
      type?: string
      webserver_type?: string
      php_version?: string | number
      nodejs_version?: string | number
      database?: { type?: string, version?: string | number }
    } | null
    if (!cfg) return EMPTY_DDEV_CONFIG
    return {
      type: cfg.type ?? null,
      webserver: cfg.webserver_type ?? 'nginx-fpm',
      phpVersion: str(cfg.php_version),
      dbType: cfg.database?.type ?? null,
      dbVersion: str(cfg.database?.version),
      nodeVersion: str(cfg.nodejs_version),
    }
  }
  catch {
    return EMPTY_DDEV_CONFIG
  }
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
