import { z } from 'zod'
import { updateSettings } from '../utils/settings'

// PATCH /api/settings → update the tunable lifecycle limits. Each field is
// optional so the UI can send only what changed; values are bounded so a stray
// input can't disable safety (e.g. an unbounded idle timeout) by accident.
const bodySchema = z.object({
  idleStopMinutes: z.number().int().min(1).max(10080).optional(),
  previewRetentionDays: z.number().int().min(0).max(365).optional(),
  archiveRetentionDays: z.number().int().min(0).max(3650).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(20).optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid settings' })
  }
  return updateSettings(result.data)
})
