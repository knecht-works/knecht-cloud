import { collectGarbage } from '../daemon/gc'

// POST /api/gc → run the reconcile GC now and report what it reclaimed. Session
// gated by the /api/** auth middleware; the same sweep also runs on a timer
// (server/plugins/gc.ts). Returns per-category lists plus a total so the
// settings page can show exactly what was removed.
export default defineEventHandler(async () => {
  const result = await collectGarbage()
  const total = Object.values(result).reduce((n, list) => n + list.length, 0)
  return { total, ...result }
})
