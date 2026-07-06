import { z } from 'zod'
import { publicSettings, updateSettings } from '../utils/settings'
import { encrypt } from '../utils/crypto'

// PATCH /api/settings → update the tunable settings. Each field is optional so
// the UI can send only what changed; values are bounded so a stray input can't
// disable safety (e.g. an unbounded idle timeout) by accident. `aiKey` is
// write-only: it is encrypted at rest and never returned.
const bodySchema = z.object({
  idleStopMinutes: z.number().int().min(1).max(10080).optional(),
  previewRetentionDays: z.number().int().min(0).max(365).optional(),
  archiveRetentionDays: z.number().int().min(0).max(3650).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(20).optional(),
  aiKey: z.string().min(1).max(500).optional(),
  aiModel: z.string().min(1).max(200).optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid settings' })
  }
  const { aiKey, ...patch } = result.data
  return publicSettings(updateSettings({
    ...patch,
    ...(aiKey ? { aiKeyEnc: encrypt(aiKey) } : {}),
  }))
})
