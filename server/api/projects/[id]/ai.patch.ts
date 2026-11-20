import { z } from 'zod'
import { defineEventHandler, readBody } from 'h3'
import { AI_PROVIDERS, type AiProviderId, LANGDOCK_REGIONS, MODEL_NAME_RE } from '#shared/utils/ai'
import { requireProject } from '#server/stores/projects'
import { getProjectAiSettings, setProjectAiSettings, type ProjectAiValues } from '#server/stores/project-ai-settings'
import { assertModelsInCatalog, mergeAiConnection, projectAiView } from '#server/utils/ai-connection'
import { getSettings } from '#server/utils/settings'
import { assertAiKeyAccepted } from '#server/utils/ai-key'
import { encrypt } from '#server/utils/crypto'
import { requireIntParam, zodBadRequest } from '#server/utils/http'
import { requireOwner } from '#server/utils/owner'

const modelName = z.string().min(1).max(200).regex(MODEL_NAME_RE)
const bodySchema = z.object({
  aiProvider: z.enum(AI_PROVIDERS.map(p => p.id) as [AiProviderId, ...AiProviderId[]]).nullable(),
  aiRegion: z.enum(LANGDOCK_REGIONS).nullable(),
  aiKey: z.string().trim().min(1).max(500).nullable(),
  aiModel: modelName.nullable(),
  aiSubtaskModel: modelName.nullable(),
}).partial()

// Null inherits the field from Settings → Agent. A provider change starts over: the key and
// models of the previous provider are dropped unless the patch sets them.
export default defineEventHandler(async (event) => {
  const id = requireProject(requireIntParam(event)).id
  await requireOwner(event)
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) zodBadRequest(result.error, 'Invalid AI connection')
  const { aiKey, ...patch } = result.data
  const existing = getProjectAiSettings(id)
  const values: ProjectAiValues = {
    aiProvider: existing?.aiProvider ?? null,
    aiRegion: existing?.aiRegion ?? null,
    aiKeyEnc: existing?.aiKeyEnc ?? null,
    aiModel: existing?.aiModel ?? null,
    aiSubtaskModel: existing?.aiSubtaskModel ?? null,
  }
  if ('aiProvider' in patch && patch.aiProvider !== values.aiProvider) {
    Object.assign(values, { aiRegion: null, aiKeyEnc: null, aiModel: null, aiSubtaskModel: null })
  }
  Object.assign(values, patch)
  if (aiKey !== undefined) values.aiKeyEnc = aiKey === null ? null : encrypt(aiKey)
  if (values.aiProvider === null) values.aiRegion = null
  else values.aiRegion ??= 'eu'
  const connection = mergeAiConnection(getSettings(), values)
  if (aiKey) await assertAiKeyAccepted(connection.aiProvider as AiProviderId, connection.aiRegion, aiKey)
  if (['aiProvider', 'aiRegion', 'aiModel', 'aiSubtaskModel'].some(f => f in patch) || aiKey) {
    await assertModelsInCatalog(connection)
  }
  setProjectAiSettings(id, values)
  return projectAiView(id)
})
