import type { AiModel } from '#shared/utils/ai'
import { loadModelCatalog } from '../utils/ai-catalog'
import { getSettings } from '../utils/settings'

// GET /api/ai-models → the model catalog for the `ai` step's pickers. All the
// loading/caching logic lives in utils/ai-catalog.ts (shared with the settings
// PATCH validation); this route only translates a failure into a 502 so the
// pickers can fall back to plain text inputs.
export default defineEventHandler(async (): Promise<AiModel[]> => {
  try {
    return await loadModelCatalog(getSettings())
  }
  catch (e) {
    throw createError({ statusCode: 502, statusMessage: (e as Error).message })
  }
})
