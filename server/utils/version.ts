import semver from 'semver'

export const RELEASE_TAG_RE = /^v\d+\.\d+\.\d+$/
export const ANY_RELEASE_TAG_RE = /^v\d+\.\d+\.\d+(-rc\.\d+)?$/

const REPO = 'knecht-works/knecht-cloud'
const CACHE_MS = 60 * 60 * 1000

export function currentVersion(): string {
  return process.env.KNECHT_VERSION || 'dev'
}

export interface Release {
  tag: string
  notes: string
  publishedAt: string | null
}

let releasesCache: { value: Release[], fetchedAt: number } | null = null

export async function listReleases(prereleases = false): Promise<Release[]> {
  const all = await fetchReleases()
  return prereleases ? all : all.filter(r => RELEASE_TAG_RE.test(r.tag))
}

async function fetchReleases(): Promise<Release[]> {
  if (releasesCache && Date.now() - releasesCache.fetchedAt < CACHE_MS) return releasesCache.value
  try {
    const res = await $fetch<{ tag_name?: string, body?: string, published_at?: string, draft?: boolean }[]>(
      `https://api.github.com/repos/${REPO}/releases?per_page=100`,
      { timeout: 5000 },
    )
    const releases = res
      .filter(r => r.tag_name && ANY_RELEASE_TAG_RE.test(r.tag_name) && !r.draft)
      .map(r => ({ tag: r.tag_name!, notes: (r.body ?? '').trim(), publishedAt: r.published_at ?? null }))
    releasesCache = { value: releases, fetchedAt: Date.now() }
  }
  catch {
    releasesCache = { value: releasesCache?.value ?? [], fetchedAt: Date.now() }
  }
  return releasesCache.value
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const cur = semver.valid(current)
  return cur !== null && semver.valid(candidate) !== null && semver.gt(candidate, cur)
}

export async function availableUpdate(prereleases = false): Promise<string | null> {
  const newest = semver.rsort((await listReleases(prereleases)).map(r => r.tag))[0]
  return newest && isNewerVersion(newest, currentVersion()) ? newest : null
}

export function clearVersionCache(): void {
  releasesCache = null
}
