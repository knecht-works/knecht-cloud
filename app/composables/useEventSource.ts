import type { MaybeRefOrGetter } from 'vue'

// A new url closes the old stream and opens one for the new url; null keeps it closed.
export function useEventSource(url: MaybeRefOrGetter<string | null>, listeners: Record<string, (e: MessageEvent) => void>): void {
  if (import.meta.server) return
  let source: EventSource | undefined
  const close = () => {
    source?.close()
    source = undefined
  }
  watch(() => toValue(url), (next) => {
    close()
    if (!next) return
    source = new EventSource(next)
    for (const [name, listener] of Object.entries(listeners)) source.addEventListener(name, listener as EventListener)
  }, { immediate: true })
  onScopeDispose(close)
}
