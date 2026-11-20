import { createError, defineEventHandler } from 'h3'
import type { AiModel } from '#shared/utils/ai'
import { requireProject } from '#server/stores/projects'
import { aiConnection } from '#server/utils/ai-connection'
import { loadModelCatalog } from '#server/utils/ai-catalog'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(async (event): Promise<AiModel[]> => {
  const id = requireProject(requireIntParam(event)).id
  try {
    return await loadModelCatalog(aiConnection(id))
  }
  catch (e) {
    throw createError({ statusCode: 502, statusMessage: (e as Error).message })
  }
})
