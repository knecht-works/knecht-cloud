const subscriptions = new Map<string, { topics: string[], count: number }>()

// Client only: module state on the server would be shared across requests.
export function useLiveTopics(key: string, topics: string[]): void {
  if (import.meta.server) return
  const entry = subscriptions.get(key) ?? { topics, count: 0 }
  entry.count++
  subscriptions.set(key, entry)
  onScopeDispose(() => {
    if (--entry.count === 0) subscriptions.delete(key)
  })
}

export function invalidate(...topics: string[]): Promise<void> {
  const keys = [...subscriptions].filter(([, s]) => s.topics.some(t => topics.includes(t))).map(([key]) => key)
  return keys.length ? refreshNuxtData(keys) : Promise.resolve()
}
