import { collectGarbage } from '../daemon/gc'

// Reconcile GC on a slow tick. Unlike the retention reaper (idle-stop.ts), this
// only reclaims leftovers whose DB row is already gone, which only appear after
// a crash or a half-done delete, so an hour of latency is fine. The settings
// page can also trigger it on demand (POST /api/gc).
const GC_INTERVAL_MS = 60 * 60_000

export default defineNitroPlugin(() => {
  setInterval(() => {
    collectGarbage()
      .then((r) => {
        const total = Object.values(r).reduce((n, list) => n + list.length, 0)
        if (total) console.log(`GC reclaimed ${total} orphaned item(s):`, r)
      })
      .catch(e => console.error('GC failed:', (e as Error).message))
  }, GC_INTERVAL_MS)
})
