import { collectGarbage } from '../daemon/gc'

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
