const keys = new Map<string, { topics: string[], count: number }>()
const listeners = new Set<{ topics: () => string[], refresh: () => unknown }>()
const pending = new Set<string | null>()
let flushing: Promise<void> | null = null

// Client only: module state on the server would be shared across requests.
export function useLiveTopics(key: string, topics: string[]): void {
  if (import.meta.server) return
  const entry = keys.get(key) ?? { topics, count: 0 }
  entry.count++
  keys.set(key, entry)
  onScopeDispose(() => {
    if (--entry.count === 0) keys.delete(key)
  })
}

// For state that is not a keyed fetch, like a run picked at runtime.
export function onLiveTopics(topics: () => string[], refresh: () => unknown): void {
  if (import.meta.server) return
  const listener = { topics, refresh }
  listeners.add(listener)
  onScopeDispose(() => listeners.delete(listener))
}

export function invalidate(...topics: string[]): Promise<void> {
  for (const topic of topics) pending.add(topic)
  return flushing ??= flush()
}

export function invalidateAll(): Promise<void> {
  pending.add(null)
  return flushing ??= flush()
}

// One refresh round at a time: topics arriving meanwhile join the next round,
// so a busy stream never cancels a refresh that is still in flight.
async function flush(): Promise<void> {
  try {
    while (pending.size) {
      const all = pending.has(null)
      const topics = [...pending]
      pending.clear()
      const hit = (t: string[]) => all || t.some(topic => topics.includes(topic))
      const matchedKeys = [...keys].filter(([, e]) => hit(e.topics)).map(([key]) => key)
      await Promise.all([
        matchedKeys.length ? refreshNuxtData(matchedKeys) : undefined,
        ...[...listeners].filter(l => hit(l.topics())).map(l => l.refresh()),
      ])
    }
  }
  finally {
    flushing = null
  }
}
