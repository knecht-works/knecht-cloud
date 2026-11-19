import { describe, expect, it } from 'vitest'
import { matchesVersion } from '#shared/utils/version'

describe('matchesVersion', () => {
  it('matches = as a prefix of the version', () => {
    expect(matchesVersion('5.4.2', '=', '5')).toBe(true)
    expect(matchesVersion('5.4.2', '=', '5.4')).toBe(true)
    expect(matchesVersion('5.4.2', '=', '5.4.2')).toBe(true)
    expect(matchesVersion('5.4.2', '=', '5.4.1')).toBe(false)
    expect(matchesVersion('5.14.0', '=', '5.1')).toBe(false)
  })

  it('compares < and > numerically, missing parts as zero', () => {
    expect(matchesVersion('5.4.2', '<', '5.4.3')).toBe(true)
    expect(matchesVersion('5.4.3', '<', '5.4.3')).toBe(false)
    expect(matchesVersion('5.10.0', '>', '5.9')).toBe(true)
    expect(matchesVersion('5.4.2', '>', '5')).toBe(true)
    expect(matchesVersion('5.4', '<', '5.4.3')).toBe(true)
  })

  it('never matches a project without a version or an unreadable target', () => {
    expect(matchesVersion(null, '<', '5')).toBe(false)
    expect(matchesVersion('5.4.2', '<', 'abc')).toBe(false)
  })
})
