import { createError } from 'h3'
import type { ProjectAiSettings, Settings } from '#server/db/schema'
import { SUBTASK_MODEL_REF, stripLegacyModelPrefix } from '#shared/utils/ai'
import { getProjectAiSettings, type ProjectAiValues } from '#server/stores/project-ai-settings'
import { loadModelCatalog } from '#server/utils/ai-catalog'
import { encKeyPreview, getSettings } from '#server/utils/settings'

export type AiConnection = Pick<Settings, 'aiProvider' | 'aiRegion' | 'aiKeyEnc' | 'aiModel' | 'aiSubtaskModel'>

function connectionOf({ aiProvider, aiRegion, aiKeyEnc, aiModel, aiSubtaskModel }: AiConnection): AiConnection {
  return { aiProvider, aiRegion, aiKeyEnc, aiModel, aiSubtaskModel }
}

export function mergeAiConnection(global: AiConnection, own: ProjectAiValues | undefined): AiConnection {
  if (!own) return connectionOf(global)
  if (own.aiProvider) {
    return { aiProvider: own.aiProvider, aiRegion: own.aiRegion ?? 'eu', aiKeyEnc: own.aiKeyEnc, aiModel: own.aiModel, aiSubtaskModel: own.aiSubtaskModel }
  }
  return {
    aiProvider: global.aiProvider,
    aiRegion: global.aiRegion,
    aiKeyEnc: own.aiKeyEnc ?? global.aiKeyEnc,
    aiModel: own.aiModel ?? global.aiModel,
    aiSubtaskModel: own.aiSubtaskModel ?? global.aiSubtaskModel,
  }
}

export function aiConnection(projectId?: number | null): AiConnection {
  return mergeAiConnection(getSettings(), projectId == null ? undefined : getProjectAiSettings(projectId))
}

// A preferred model the project's provider does not offer runs on the global connection.
export async function resolveAiConnection(
  projectId: number | null | undefined,
  preferredModel?: string | null,
): Promise<{ connection: AiConnection, model: string | null }> {
  const preferred = preferredModel?.trim() ? stripLegacyModelPrefix(preferredModel.trim()) : null
  const global = connectionOf(getSettings())
  const own = projectId == null ? undefined : getProjectAiSettings(projectId)
  const connection = mergeAiConnection(global, own)
  if (!preferred) return { connection, model: connection.aiModel }
  if (preferred === SUBTASK_MODEL_REF) return { connection, model: connection.aiSubtaskModel ?? connection.aiModel }
  if (connection.aiProvider === global.aiProvider || await offersModel(connection, preferred)) {
    return { connection, model: preferred }
  }
  return { connection: global, model: preferred }
}

function publicOverrides(row: ProjectAiSettings | undefined) {
  if (!row) return null
  const { aiKeyEnc, projectId: _, updatedAt: __, ...rest } = row
  return { ...rest, aiKeyPreview: aiKeyEnc ? encKeyPreview(aiKeyEnc) : undefined }
}

export function projectAiView(projectId: number) {
  const own = getProjectAiSettings(projectId)
  const effective = mergeAiConnection(getSettings(), own)
  return {
    overrides: publicOverrides(own),
    effective: { aiProvider: effective.aiProvider, aiModel: effective.aiModel, aiKeyConfigured: !!effective.aiKeyEnc },
  }
}

// A provider (or region/key/model) change must fail at save time when the
// stored model would no longer resolve, not mid-run. Best
// effort by design: when the catalog itself cannot be loaded the save goes
// through, because a catalog outage must never lock the settings page.
export async function assertModelsInCatalog(connection: AiConnection): Promise<void> {
  if (!connection.aiModel && !connection.aiSubtaskModel) return
  let ids: Set<string>
  try {
    ids = new Set((await loadModelCatalog(connection)).map(m => m.id))
  }
  catch {
    return
  }
  if (connection.aiModel && !ids.has(connection.aiModel)) {
    throw createError({
      statusCode: 400,
      statusMessage: `The model '${connection.aiModel}' is not available at ${connection.aiProvider}. Pick a model from its catalog first.`,
    })
  }
  if (connection.aiSubtaskModel && !ids.has(connection.aiSubtaskModel)) {
    throw createError({
      statusCode: 400,
      statusMessage: `The subtask model '${connection.aiSubtaskModel}' is not available at ${connection.aiProvider}. Clear or change it first.`,
    })
  }
}

async function offersModel(connection: AiConnection, model: string): Promise<boolean> {
  try {
    return (await loadModelCatalog(connection)).some(m => m.id === model)
  }
  catch {
    // A catalog outage must not silently move the project's usage onto the global key.
    return true
  }
}
