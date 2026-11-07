import { describe, expect, it } from 'vitest'
import { ELEVATION_TTL_MS, isElevated } from '../../shared/utils/elevation'

describe('isElevated', () => {
  it('holds for an hour after the last confirmation', () => {
    expect(isElevated(undefined, 0)).toBe(false)
    expect(isElevated(1000, 1000 + ELEVATION_TTL_MS - 1)).toBe(true)
    expect(isElevated(1000, 1000 + ELEVATION_TTL_MS)).toBe(false)
  })
})
