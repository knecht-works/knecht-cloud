import { describe, expect, it } from 'vitest'
import { isNewerVersion } from '../../server/utils/version'

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
    // An RC of a FUTURE version is ahead of the offered stable: no downgrade.
    expect(isNewerVersion('v0.3.0', 'v0.4.0-rc.1')).toBe(false)
  })

  it('never offers updates to non-release builds', () => {
    expect(isNewerVersion('v0.3.0', 'dev')).toBe(false)
    expect(isNewerVersion('dev', 'v0.2.0')).toBe(false)
  })
})
