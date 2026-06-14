import type { H3Event } from 'h3'
import { Octokit } from 'octokit'
import { parse } from 'yaml'

// Build an Octokit client from the logged-in user's OAuth token. The token came
// from the GitHub login (repo scope) and doubles as the clone/PR credential
// (internals/docs/tech-stack.md §3).
export async function getGithubClient(event: H3Event): Promise<Octokit> {
  const { secure } = await requireUserSession(event)
  if (!secure?.githubToken) {
    throw createError({ statusCode: 401, statusMessage: 'No GitHub token in session' })
  }
  return new Octokit({ auth: secure.githubToken })
}

// Read the DDEV project type from a repo's `.ddev/config.yaml` `type:` field
// (https://docs.ddev.com/en/stable/users/configuration/config/#type), e.g.
// 'typo3', 'wordpress', 'craftcms'. Best-effort: returns null if the file or
// field is missing, or the repo can't be read.
export async function fetchDdevType(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref?: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: '.ddev/config.yaml',
      ref,
    })
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null
    const content = Buffer.from(data.content, 'base64').toString('utf8')
    const cfg = parse(content) as { type?: string } | null
    return cfg?.type ?? null
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
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: 'composer.lock',
      ref,
    })
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data) || !data.content) return null
    const lock = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')) as {
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
