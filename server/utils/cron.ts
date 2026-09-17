import { Cron } from 'croner'

function pattern(expr: string): Cron {
  return new Cron(expr, { mode: '5-part', sloppyRanges: true })
}

export function isValidCron(expr: string): boolean {
  try {
    pattern(expr)
    return true
  }
  catch {
    return false
  }
}

export function nextRun(expr: string, from: Date = new Date()): Date | null {
  return pattern(expr).nextRun(from)
}
