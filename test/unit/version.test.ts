import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearVersionCache, isNewerVersion, latestVersion, listReleases } from '#server/utils/version'

describe('isNewerVersion', () => {
  it('compares stable tags numerically', () => {
    expect(isNewerVersion('v0.3.0', 'v0.2.0')).toBe(true)
    expect(isNewerVersion('v0.10.0', 'v0.9.9')).toBe(true)
    expect(isNewerVersion('v0.2.0', 'v0.2.0')).toBe(false)
    expect(isNewerVersion('v0.2.0', 'v0.3.0')).toBe(false)
  })

  it('never offers a pre-release as candidate', () => {
    expect(isNewerVersion('v0.3.0-rc.1', 'v0.2.0')).toBe(false)
  })

  it('supersedes a running pre-release with its stable release', () => {
    expect(isNewerVersion('v0.3.0', 'v0.3.0-rc.1')).toBe(true)
    expect(isNewerVersion('v0.4.0', 'v0.3.0-rc.1')).toBe(true)
    expect(isNewerVersion('v0.3.0', 'v0.4.0-rc.1')).toBe(false)
  })

  it('offers pre-releases only when asked to', () => {
    expect(isNewerVersion('v0.3.0-rc.2', 'v0.3.0-rc.1', true)).toBe(true)
    expect(isNewerVersion('v0.3.0-rc.1', 'v0.2.0', true)).toBe(true)
    expect(isNewerVersion('v0.3.0-rc.1', 'v0.3.0', true)).toBe(false)
    expect(isNewerVersion('v0.3.0-rc.2', 'v0.3.0-rc.1')).toBe(false)
    expect(isNewerVersion('v0.3.0-beta.1', 'v0.2.0', true)).toBe(false)
  })

  it('never offers updates to non-release builds', () => {
    expect(isNewerVersion('v0.3.0', 'dev')).toBe(false)
    expect(isNewerVersion('dev', 'v0.2.0')).toBe(false)
  })
})

describe('release list', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    clearVersionCache()
  })

  it('includes release candidates only when asked to', async () => {
    vi.stubGlobal('$fetch', async () => [
      { tag_name: 'v0.3.0-rc.2' },
      { tag_name: 'v0.2.1' },
      { tag_name: 'v0.3.0-rc.1' },
      { tag_name: 'v0.4.0-beta.1' },
      { tag_name: 'v0.5.0', draft: true },
    ])
    expect((await listReleases()).map(r => r.tag)).toEqual(['v0.2.1'])
    expect((await listReleases(true)).map(r => r.tag)).toEqual(['v0.3.0-rc.2', 'v0.2.1', 'v0.3.0-rc.1'])
    expect(await latestVersion(true)).toBe('v0.3.0-rc.2')
  })

  it('picks the stable release over its own candidates', async () => {
    vi.stubGlobal('$fetch', async () => [{ tag_name: 'v0.3.0-rc.2' }, { tag_name: 'v0.3.0' }])
    expect(await latestVersion(true)).toBe('v0.3.0')
  })
})
