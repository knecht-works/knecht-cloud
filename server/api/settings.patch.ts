import { z } from 'zod'
import { AI_PROVIDERS, type AiProviderId } from '#shared/utils/ai'
import { SETTINGS_LIMITS, SSH_TARGET_RE } from '#shared/utils/settings-limits'
import { publicSettings, updateSettings } from '../utils/settings'
import { encrypt } from '../utils/crypto'

// PATCH /api/settings → update the tunable settings. Each field is optional so
// the UI can send only what changed; values are bounded (SETTINGS_LIMITS, also
// enforced inline by the settings pages) so a stray input can't disable safety
// (e.g. an unbounded idle timeout) by accident. `aiKey` is write-only: it is
// encrypted at rest and never returned; null removes the stored key.
const L = SETTINGS_LIMITS
const bodySchema = z.object({
  idleStopMinutes: z.number().int().min(L.idleStopMinutes.min).max(L.idleStopMinutes.max).optional(),
  previewRetentionDays: z.number().int().min(L.previewRetentionDays.min).max(L.previewRetentionDays.max).optional(),
  archiveRetentionDays: z.number().int().min(L.archiveRetentionDays.min).max(L.archiveRetentionDays.max).optional(),
  maxConcurrentRuns: z.number().int().min(L.maxConcurrentRuns.min).max(L.maxConcurrentRuns.max).optional(),
  aiProvider: z.enum(AI_PROVIDERS.map(p => p.id) as [AiProviderId, ...AiProviderId[]]).optional(),
  aiKey: z.string().min(1).max(500).nullable().optional(),
  aiModel: z.string().min(1).max(200).optional(),
  sshTarget: z.string().trim().regex(SSH_TARGET_RE).max(200).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    const field = result.error.issues[0]?.path.join('.')
    throw createError({ statusCode: 400, statusMessage: field ? `Invalid value for ${field}` : 'Invalid settings' })
  }
  const { aiKey, ...patch } = result.data
  return publicSettings(updateSettings({
    ...patch,
    ...(aiKey !== undefined ? { aiKeyEnc: aiKey === null ? null : encrypt(aiKey) } : {}),
  }))
})
