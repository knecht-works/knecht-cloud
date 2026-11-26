import { collectGarbage } from '#server/daemon/gc'
import { defineNitroPlugin } from 'nitropack/runtime'

const GC_INTERVAL_MS = 60 * 60_000

export default defineNitroPlugin(() => {
  // A marketing DB does not know the dev sessions, so GC would reap their environments.
  if (process.env.KNECHT_GC === 'off') return
  setInterval(() => {
    collectGarbage()
      .then((r) => {
        const total = Object.values(r).reduce((n, list) => n + list.length, 0)
        if (total) console.log(`GC reclaimed ${total} orphaned item(s):`, r)
      })
      .catch(e => console.error('GC failed:', (e as Error).message))
  }, GC_INTERVAL_MS)
})
