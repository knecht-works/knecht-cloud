// A minimal standard 5-field cron evaluator: "minute hour day-of-month month
// day-of-week". Each field supports '*', '*/n' steps, 'a-b' ranges, 'a,b' lists
// and plain numbers: enough for the schedules the Triggers UI generates and for
// hand-written ones. No seconds, no '@' aliases, no 'L/W/#'. Day-of-month and
// day-of-week combine with OR when both are restricted (the POSIX rule).

interface CronSpec {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domRestricted: boolean
  dowRestricted: boolean
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step in "${part}"`)

    let lo: number
    let hi: number
    if (rangePart === '*') {
      lo = min
      hi = max
    }
    else if (rangePart!.includes('-')) {
      const [a, b] = rangePart!.split('-').map(Number)
      lo = a!
      hi = b!
    }
    else {
      lo = Number(rangePart)
      // "n/step" means "from n to the end, every step"; a bare "n" is just n.
      hi = stepPart === undefined ? lo : max
    }

    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`Field value out of range in "${part}"`)
    }
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

function parseCron(expr: string): CronSpec {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('Cron must have exactly 5 fields')
  const [minute, hour, dom, month, dowField] = fields as [string, string, string, string, string]

  const dow = parseField(dowField, 0, 7)
  // Cron allows 7 for Sunday; JS Date.getDay() uses 0. Normalize.
  if (dow.delete(7)) dow.add(0)

  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dom: parseField(dom, 1, 31),
    month: parseField(month, 1, 12),
    dow,
    domRestricted: dom !== '*',
    dowRestricted: dowField !== '*',
  }
}

// True if `expr` parses as a cron expression we can evaluate.
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr)
    return true
  }
  catch {
    return false
  }
}

function matches(spec: CronSpec, t: Date): boolean {
  if (!spec.minute.has(t.getMinutes())) return false
  if (!spec.hour.has(t.getHours())) return false
  if (!spec.month.has(t.getMonth() + 1)) return false

  const domOk = spec.dom.has(t.getDate())
  const dowOk = spec.dow.has(t.getDay())
  // POSIX: when both day fields are restricted, a match on either is enough.
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk
  if (spec.domRestricted) return domOk
  if (spec.dowRestricted) return dowOk
  return true
}

// The next local time strictly after `from` that the expression matches, found by
// scanning minute by minute up to ~13 months ahead. Returns null when nothing
// matches in that window (e.g. an impossible "0 0 30 2 *"). Date math handles DST
// and month lengths.
export function nextRun(expr: string, from: Date = new Date()): Date | null {
  const spec = parseCron(expr)
  const t = new Date(from.getTime())
  t.setSeconds(0, 0)
  t.setMinutes(t.getMinutes() + 1)
  for (let i = 0; i < 400 * 24 * 60; i++) {
    if (matches(spec, t)) return t
    t.setMinutes(t.getMinutes() + 1)
  }
  return null
}
