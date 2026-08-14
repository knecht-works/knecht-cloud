import { z } from 'zod'
import { AI_PROVIDERS, type AiProviderId, LANGDOCK_REGIONS, MODEL_NAME_RE } from '#shared/utils/ai'
import { AGENT_INSTRUCTIONS_MAX, SETTINGS_LIMITS, SSH_TARGET_RE } from '#shared/utils/settings-limits'
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
  // Bare model names, no provider prefix. The subtask model
  // becomes opencode's small_model; null clears it (main model does it all).
  // The default model is also nullable: a provider switch clears it (the old
  // provider's name would not resolve) and ai steps refuse to run until a new
  // one is picked.
  aiModel: z.string().min(1).max(200).regex(MODEL_NAME_RE).nullable().optional(),
  aiSubtaskModel: z.string().min(1).max(200).regex(MODEL_NAME_RE).nullable().optional(),
  // Instance-level agent instructions.
  agentInstructions: z.string().max(AGENT_INSTRUCTIONS_MAX).optional(),
  sshTarget: z.string().trim().regex(SSH_TARGET_RE).max(200).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    const field = result.error.issues[0]?.path.join('.')
    throw createError({ statusCode: 400, statusMessage: field ? `Invalid value for ${field}` : 'Invalid settings' })
  }
  const { aiKey, ...patch } = result.data
  const settingsPatch: SettingsPatch = {
    ...patch,
    ...(aiKey !== undefined ? { aiKeyEnc: aiKey === null ? null : encrypt(aiKey) } : {}),
  }
  // A provider switch clears both models (unless the patch sets them): the old
  // provider's names would not resolve at the new one, and a stale model must
  // never block saving the new provider's API key.
  if (settingsPatch.aiProvider && settingsPatch.aiProvider !== getSettings().aiProvider) {
    if (!('aiModel' in settingsPatch)) settingsPatch.aiModel = null
    if (!('aiSubtaskModel' in settingsPatch)) settingsPatch.aiSubtaskModel = null
  }
  await assertModelInCatalog(settingsPatch)
  return publicSettings(updateSettings(settingsPatch))
})

// A provider (or region/key/model) change must fail at save time when the
// stored model would no longer resolve, not mid-run. Best
// effort by design: when the catalog itself cannot be loaded the save goes
// through, because a catalog outage must never lock the settings page.
async function assertModelInCatalog(patch: SettingsPatch): Promise<void> {
  if (!['aiProvider', 'aiRegion', 'aiModel', 'aiSubtaskModel', 'aiKeyEnc'].some(f => f in patch)) return
  const effective = { ...getSettings(), ...patch }
  if (!effective.aiModel && !effective.aiSubtaskModel) return
  let ids: Set<string>
  try {
    ids = new Set((await loadModelCatalog(effective)).map(m => m.id))
  }
  catch {
    return
  }
  if (effective.aiModel && !ids.has(effective.aiModel)) {
    throw createError({
      statusCode: 400,
      statusMessage: `The model '${effective.aiModel}' is not available at ${effective.aiProvider}. Pick a model from its catalog first.`,
    })
  }
  if (effective.aiSubtaskModel && !ids.has(effective.aiSubtaskModel)) {
    throw createError({
      statusCode: 400,
      statusMessage: `The subtask model '${effective.aiSubtaskModel}' is not available at ${effective.aiProvider}. Clear or change it first.`,
    })
  }
}
