import type { Ref } from 'vue'
import { useState, onNuxtReady, setInterval } from '#imports'

let ticking = false

// The server's clock is reused for hydration, or a live duration renders a different second on the client.
export function useNow(): Readonly<Ref<number>> {
  const now = useState('now', () => Date.now())
  if (import.meta.client && !ticking) {
    ticking = true
    onNuxtReady(() => setInterval(() => {
      now.value = Date.now()
    }, 1000))
  }
  return now
}
