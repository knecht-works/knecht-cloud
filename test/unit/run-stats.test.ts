import { describe, expect, it } from 'vitest'
import { computeRunStats, type StatsRun } from '../../shared/utils/run-stats'

const now = new Date(2026, 9, 14, 15, 0)

function run(daysAgo: number, status: string, opts: { trigger?: string, seconds?: number } = {}): StatsRun {
  const createdAt = new Date(2026, 9, 14 - daysAgo, 10, 0)
  const startedAt = createdAt
  const finishedAt = new Date(createdAt.getTime() + (opts.seconds ?? 60) * 1000)
  return { status, trigger: opts.trigger ?? 'manual', createdAt, startedAt, finishedAt }
}

describe('computeRunStats', () => {
  it('buckets runs per local day, oldest first, ending today', () => {
    const stats = computeRunStats([run(0, 'success'), run(0, 'failed'), run(13, 'success'), run(14, 'success')], now)
    expect(stats.days).toHaveLength(14)
    expect(stats.days[13]).toEqual({ success: 1, failed: 1 })
    expect(stats.days[0]).toEqual({ success: 1, failed: 0 })
    expect(stats.total).toBe(3)
  })

  it('leaves cancelled and live runs out of the success rate', () => {
    const stats = computeRunStats([run(1, 'success'), run(1, 'failed'), run(1, 'cancelled'), run(1, 'running')], now)
    expect(stats.rate.value).toBe(50)
  })

  it('compares against the 14 days before the window', () => {
    const stats = computeRunStats([
      run(1, 'success', { seconds: 300 }),
      run(2, 'success', { seconds: 100 }),
      run(20, 'success', { seconds: 400 }),
      run(20, 'failed'),
    ], now)
    expect(stats.rate.delta).toBe(50)
    expect(stats.duration.value).toBe(200)
    expect(stats.duration.delta).toBe(-200)
  })

  it('has no values without runs', () => {
    const stats = computeRunStats([], now)
    expect(stats.rate).toEqual({ value: null, delta: null, series: [] })
    expect(stats.duration.value).toBeNull()
    expect(stats.triggered).toBeNull()
  })

  it('counts every run not started by hand as triggered', () => {
    const stats = computeRunStats([run(1, 'success', { trigger: 'github' }), run(1, 'success', { trigger: 'mention' }), run(1, 'success'), run(1, 'success')], now)
    expect(stats.triggered).toBe(50)
  })
})
