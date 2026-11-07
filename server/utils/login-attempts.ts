const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 10

const failures = new Map<string, number[]>()

function recent(key: string, now: number): number[] {
  const kept = (failures.get(key) ?? []).filter(t => now - t < WINDOW_MS)
  if (kept.length) failures.set(key, kept)
  else failures.delete(key)
  return kept
}

// Counted per username and per client, so neither guessing one account's password
// nor trying many accounts from one client gets more than a few tries.
export function isLoginBlocked(keys: string[], now = Date.now()): boolean {
  return keys.some(key => recent(key, now).length >= MAX_FAILURES)
}

export function recordLoginFailure(keys: string[], now = Date.now()): void {
  for (const key of keys) failures.set(key, [...recent(key, now), now])
}

export function clearLoginFailures(keys: string[]): void {
  for (const key of keys) failures.delete(key)
}
