import semver from 'semver'

export const RELEASE_TAG_RE = /^v\d+\.\d+\.\d+$/

const REPO = 'knecht-works/knecht-cloud'
const CACHE_MS = 60 * 60 * 1000

export function currentVersion(): string {
  return process.env.KNECHT_VERSION || 'dev'
}

let cache: { value: string | null, fetchedAt: number } | null = null

export async function latestVersion(): Promise<string | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.value
  try {
    const res = await $fetch<{ tag_name?: string }>(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { timeout: 5000 },
    )
    const tag = res.tag_name && RELEASE_TAG_RE.test(res.tag_name) ? res.tag_name : null
    cache = { value: tag, fetchedAt: Date.now() }
  }
  catch {
    cache = { value: cache?.value ?? null, fetchedAt: Date.now() }
  }
  return cache.value
}

export interface Release {
  tag: string
  notes: string
  publishedAt: string | null
}

let releasesCache: { value: Release[], fetchedAt: number } | null = null

export async function listReleases(): Promise<Release[]> {
  if (releasesCache && Date.now() - releasesCache.fetchedAt < CACHE_MS) return releasesCache.value
  try {
    const res = await $fetch<{ tag_name?: string, body?: string, published_at?: string, draft?: boolean, prerelease?: boolean }[]>(
      `https://api.github.com/repos/${REPO}/releases?per_page=20`,
      { timeout: 5000 },
    )
    const releases = res
      .filter(r => r.tag_name && RELEASE_TAG_RE.test(r.tag_name) && !r.draft && !r.prerelease)
      .map(r => ({ tag: r.tag_name!, notes: (r.body ?? '').trim(), publishedAt: r.published_at ?? null }))
    releasesCache = { value: releases, fetchedAt: Date.now() }
  }
  catch {
    releasesCache = { value: releasesCache?.value ?? [], fetchedAt: Date.now() }
  }
  return releasesCache.value
}

export function isNewerVersion(candidate: string, current: string): boolean {
  if (!RELEASE_TAG_RE.test(candidate)) return false
  const cur = semver.valid(current)
  return cur !== null && semver.gt(candidate, cur)
}
