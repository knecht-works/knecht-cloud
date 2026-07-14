import { describe, expect, it } from 'vitest'
import { isValidCron, nextRun } from '../../server/utils/cron'

// Local-time construction, mirroring how the evaluator matches (Date getters).
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi)

describe('isValidCron', () => {
  it.each([
    ['*/15 * * * *', true],
    ['0 6 * * 1-5', true],
    ['0 0 1,15 * *', true],
    ['5/10 * * * *', true],
    ['61 * * * *', false],
    ['* * * *', false],
    ['*/0 * * * *', false],
    ['a b c d e', false],
  ])('%s -> %s', (expr, valid) => {
    expect(isValidCron(expr)).toBe(valid)
  })
})

describe('nextRun', () => {
  it('finds the next matching minute strictly after `from`', () => {
    expect(nextRun('*/15 * * * *', at(2026, 7, 14, 10, 7))).toEqual(at(2026, 7, 14, 10, 15))
    // Exactly on a match: strictly after, so the next slot.
    expect(nextRun('*/15 * * * *', at(2026, 7, 14, 10, 15))).toEqual(at(2026, 7, 14, 10, 30))
  })

  it('rolls over to the next day and respects weekday ranges', () => {
    // 2026-07-14 is a Tuesday; 06:00 already passed.
    expect(nextRun('0 6 * * 1-5', at(2026, 7, 14, 9, 0))).toEqual(at(2026, 7, 15, 6, 0))
    // Friday 18:00 from a Saturday: next Friday.
    expect(nextRun('0 18 * * 5', at(2026, 7, 18, 0, 0))).toEqual(at(2026, 7, 24, 18, 0))
  })

  it('treats day-of-month and day-of-week as OR when both are restricted (POSIX)', () => {
    // From Wed 2026-07-01: the 13th is far, but Friday the 3rd comes first.
    expect(nextRun('0 0 13 * 5', at(2026, 7, 1, 12, 0))).toEqual(at(2026, 7, 3, 0, 0))
    // Only day-of-month restricted: the weekday must not shortcut it.
    expect(nextRun('0 0 13 * *', at(2026, 7, 1, 12, 0))).toEqual(at(2026, 7, 13, 0, 0))
  })

  it('accepts 7 as Sunday', () => {
    // 2026-07-19 is a Sunday.
    expect(nextRun('0 8 * * 7', at(2026, 7, 14, 0, 0))).toEqual(at(2026, 7, 19, 8, 0))
  })

  it('returns null when nothing ever matches', () => {
    expect(nextRun('0 0 30 2 *', at(2026, 7, 14, 0, 0))).toBeNull()
  })
})
