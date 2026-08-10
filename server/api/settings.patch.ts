import { z } from 'zod'
import { AI_PROVIDERS, type AiProviderId, LANGDOCK_REGIONS, MODEL_NAME_RE } from '#shared/utils/ai'
import { SETTINGS_LIMITS, SSH_TARGET_RE } from '#shared/utils/settings-limits'
import { getSettings, publicSettings, type SettingsPatch, updateSettings } from '../utils/settings'
import { loadModelCatalog } from '../utils/ai-catalog'
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
  aiRegion: z.enum(LANGDOCK_REGIONS).optional(),
  aiKey: z.string().min(1).max(500).nullable().optional(),
  // Bare model name (docs/adr/0003), no provider prefix.
  aiModel: z.string().min(1).max(200).regex(MODEL_NAME_RE).optional(),
  sshTarget: z.string().trim().regex(SSH_TARGET_RE).max(200).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    const field = result.error.issues[0]?.path.join('.')
    throw createError({ statusCode: 400, statusMessage: field ? `Invalid value for ${field}` : 'Invalid settings' })
  }
  const { aiKey, ...patch } = result.data
  const settingsPatch = {
    ...patch,
    ...(aiKey !== undefined ? { aiKeyEnc: aiKey === null ? null : encrypt(aiKey) } : {}),
  }
  await assertModelInCatalog(settingsPatch)
  return publicSettings(updateSettings(settingsPatch))
})

// A provider (or region/key/model) change must fail at save time when the
// stored model would no longer resolve, not mid-run (docs/adr/0003). Best
// effort by design: when the catalog itself cannot be loaded the save goes
// through, because a catalog outage must never lock the settings page.
async function assertModelInCatalog(patch: SettingsPatch): Promise<void> {
  if (!['aiProvider', 'aiRegion', 'aiModel', 'aiKeyEnc'].some(f => f in patch)) return
  const effective = { ...getSettings(), ...patch }
  let ids: Set<string>
  try {
    ids = new Set((await loadModelCatalog(effective)).map(m => m.id))
  }
  catch {
    return
  }
  if (!ids.has(effective.aiModel)) {
    throw createError({
      statusCode: 400,
      statusMessage: `The model '${effective.aiModel}' is not available at ${effective.aiProvider}. Pick a model from its catalog first.`,
    })
  }
}
