export interface StatsRun {
  status: string
  trigger: string | null
  startedAt: string | number | Date | null
  finishedAt: string | number | Date | null
  createdAt: string | number | Date
}

export interface RunStats {
  days: { success: number, failed: number }[]
  total: number
  rate: { value: number | null, delta: number | null, series: number[] }
  duration: { value: number | null, delta: number | null, series: number[] }
  triggered: number | null
}

const DAY_MS = 86_400_000

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function successRate(runs: StatsRun[]): number | null {
  const finished = runs.filter(r => r.status === 'success' || r.status === 'failed')
  if (!finished.length) return null
  return Math.round(finished.filter(r => r.status === 'success').length / finished.length * 100)
}

function durations(runs: StatsRun[]): number[] {
  return runs
    .filter(r => r.status === 'success' && r.startedAt && r.finishedAt)
    .map(r => (new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime()) / 1000)
    .filter(n => Number.isFinite(n) && n >= 0)
}

function diff(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous
}

// Days are local calendar days; the window ends with today and the deltas
// compare it against the same number of days right before it.
export function computeRunStats(runs: StatsRun[], now: Date, days = 14): RunStats {
  const start = startOfDay(now.getTime()) - (days - 1) * DAY_MS
  const prevStart = start - days * DAY_MS

  const buckets: StatsRun[][] = Array.from({ length: days }, () => [])
  const previous: StatsRun[] = []
  for (const r of runs) {
    const t = new Date(r.createdAt).getTime()
    if (t >= start) {
      const i = Math.round((startOfDay(t) - start) / DAY_MS)
      if (i < days) buckets[i]!.push(r)
    }
    else if (t >= prevStart) {
      previous.push(r)
    }
  }
  const current = buckets.flat()

  const rate = successRate(current)
  const duration = median(durations(current))

  return {
    days: buckets.map(b => ({
      success: b.filter(r => r.status === 'success').length,
      failed: b.filter(r => r.status === 'failed').length,
    })),
    total: current.length,
    rate: {
      value: rate,
      delta: diff(rate, successRate(previous)),
      series: buckets.map(successRate).filter((v): v is number => v !== null),
    },
    duration: {
      value: duration,
      delta: diff(duration, median(durations(previous))),
      series: buckets.map(b => median(durations(b))).filter((v): v is number => v !== null),
    },
    triggered: current.length
      ? Math.round(current.filter(r => r.trigger !== 'manual').length / current.length * 100)
      : null,
  }
}
