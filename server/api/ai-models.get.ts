import type { AiModel } from '#shared/utils/ai'
import { PROVIDER_KEY_ENV } from '../workflows/actions/ai'

// GET /api/ai-models → the model catalog for the `ai` step's pickers, from
// models.dev (the registry opencode itself resolves providers from), filtered
// to the providers the action can hand a key to. Cached in memory so the
// builder doesn't hammer a third party; a failed refresh serves the stale
// catalog rather than erroring.
const TTL_MS = 60 * 60 * 1000
let cache: { at: number, models: AiModel[] } | null = null

interface RegistryProvider {
  name?: string
  models?: Record<string, { name?: string }>
}

export default defineEventHandler(async (): Promise<AiModel[]> => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.models
  try {
    const res = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`)
    const registry = await res.json() as Record<string, RegistryProvider>
    const models = Object.keys(PROVIDER_KEY_ENV)
      .flatMap((provider) => {
        const entry = registry[provider]
        return Object.entries(entry?.models ?? {}).map(([id, m]) => ({
          id: `${provider}/${id}`,
          name: m.name ?? id,
          provider: entry?.name ?? provider,
        }))
      })
      .sort((a, b) => a.id.localeCompare(b.id))
    cache = { at: Date.now(), models }
    return models
  }
  catch (e) {
    if (cache) return cache.models
    throw createError({ statusCode: 502, statusMessage: `Could not load the model catalog: ${(e as Error).message}` })
  }
})
