import { z } from 'zod'
import { AI_PROVIDERS, type AiProviderId, LANGDOCK_REGIONS, MODEL_NAME_RE } from '#shared/utils/ai'
import { PREVIEW_ACCESS } from '#shared/utils/preview-access'
import { AGENT_INSTRUCTIONS_MAX, SETTINGS_LIMITS, SSH_TARGET_RE } from '#shared/utils/settings-limits'
import { getSettings, publicSettings, type SettingsPatch, updateSettings } from '#server/utils/settings'
import { settingsPreset } from '#server/utils/settings-preset'
import { isValidCron } from '#server/utils/cron'
import { assertModelsInCatalog } from '#server/utils/ai-connection'
import { assertAiKeyAccepted } from '#server/utils/ai-key'
import { encrypt } from '#server/utils/crypto'
import { detachFromGlobalProvider } from '#server/stores/project-ai-settings'
import { requireOwner } from '#server/utils/owner'
import { defineEventHandler, readBody, createError } from 'h3'

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
  previewAccess: z.enum(PREVIEW_ACCESS).optional(),
  shareLinkHours: z.number().int().min(L.shareLinkHours.min).max(L.shareLinkHours.max).nullable().optional(),
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
  // 5-field cron schedule for automatic updates; '' turns them off.
  autoUpdateCron: z.string().trim().max(100).optional(),
  prereleaseUpdates: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    const field = result.error.issues[0]?.path.join('.')
    throw createError({ statusCode: 400, statusMessage: field ? `Invalid value for ${field}` : 'Invalid settings' })
  }
  // Only the agent instructions are open to members; the rest picks the third party that
  // receives every run's code and prompts, or runs and deletes things for the whole instance.
  if (Object.keys(result.data).some(f => f !== 'agentInstructions')) {
    await requireOwner(event)
  }
  // Fields pinned by the installation's env preset are read-only: the write
  // would be shadowed on every read anyway, and silently accepting it would
  // lie to the caller.
  const preset = Object.keys(result.data).find(f => settingsPreset().keys.includes(f))
  if (preset) {
    throw createError({ statusCode: 400, statusMessage: `The setting '${preset}' is preset by the installation.` })
  }
  if (result.data.autoUpdateCron && !isValidCron(result.data.autoUpdateCron)) {
    throw createError({ statusCode: 400, statusMessage: 'Not a valid cron schedule (5 fields, e.g. "0 3 * * *").' })
  }
  const { aiKey, ...patch } = result.data
  if (aiKey) {
    const current = getSettings()
    await assertAiKeyAccepted(patch.aiProvider ?? current.aiProvider as AiProviderId, patch.aiRegion ?? current.aiRegion, aiKey)
  }
  const settingsPatch: SettingsPatch = {
    ...patch,
    ...(aiKey !== undefined ? { aiKeyEnc: aiKey === null ? null : encrypt(aiKey) } : {}),
  }
  // A provider switch clears the key and both models (unless the patch sets them): the old
  // provider's names would not resolve at the new one, and a stale model must
  // never block saving the new provider's API key.
  if (settingsPatch.aiProvider && settingsPatch.aiProvider !== getSettings().aiProvider) {
    if (!('aiKeyEnc' in settingsPatch)) settingsPatch.aiKeyEnc = null
    if (!('aiModel' in settingsPatch)) settingsPatch.aiModel = null
    if (!('aiSubtaskModel' in settingsPatch)) settingsPatch.aiSubtaskModel = null
  }
  await assertModelInCatalog(settingsPatch)
  const previous = getSettings()
  const updated = updateSettings(settingsPatch)
  if (updated.aiProvider !== previous.aiProvider) detachFromGlobalProvider(previous)
  return publicSettings(updated)
})

async function assertModelInCatalog(patch: SettingsPatch): Promise<void> {
  if (!['aiProvider', 'aiRegion', 'aiModel', 'aiSubtaskModel', 'aiKeyEnc'].some(f => f in patch)) return
  await assertModelsInCatalog({ ...getSettings(), ...patch })
}
