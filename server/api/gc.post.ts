import { statfs } from 'node:fs/promises'
import { z } from 'zod'
import { GC_CATEGORY_IDS } from '#shared/utils/gc'
import { collectGarbage } from '#server/daemon/gc'
import { zodBadRequest } from '#server/utils/http'
import { dataDir } from '#server/utils/storage'
import { defineEventHandler, readBody } from 'h3'

const bodySchema = z.object({
  categories: z.array(z.enum(GC_CATEGORY_IDS)).min(1).optional(),
})

// The disk under the data dir: docker's images and volumes only count when they share it.
async function freeBytes(): Promise<number> {
  const { bavail, bsize } = await statfs(dataDir())
  return bavail * bsize
}

// POST /api/gc → run the reconcile GC now and report what it reclaimed. Session
// gated by the /api/** auth middleware; the same sweep also runs on a timer
// (server/plugins/gc.ts). Returns per-category lists plus a total so the
// settings page can show exactly what was removed.
export default defineEventHandler(async (event) => {
  const body = bodySchema.safeParse(await readBody(event) ?? {})
  if (!body.success) zodBadRequest(body.error, 'Invalid cleanup request')
  const before = await freeBytes()
  const result = await collectGarbage(body.data.categories)
  const total = Object.values(result).reduce((n, list) => n + list.length, 0)
  return { total, freedBytes: Math.max(0, await freeBytes() - before), ...result }
})
