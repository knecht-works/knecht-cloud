import { AI_PROVIDERS, type AiModel, type AiProviderId } from '#shared/utils/ai'
import { getSettings } from '../utils/settings'
import { decrypt } from '../utils/crypto'

// GET /api/ai-models → the model catalog for the `ai` step's pickers, scoped
// to the configured provider. For OpenCode with a key on file the list comes
// from Zen itself (its /models reflects models disabled for the workspace) and
// is cached only briefly, so toggling a model over there shows up on the next
// page load; the models.dev registry (everything else, and the Zen fallback)
// changes rarely and keeps a long TTL. Cache is keyed to provider + key so a
// settings change refetches; a failed refresh serves the stale catalog.
const ZEN_TTL_MS = 30 * 1000
const REGISTRY_TTL_MS = 60 * 60 * 1000
let cache: { at: number, ttl: number, scope: string, models: AiModel[] } | null = null

export default defineEventHandler(async (): Promise<AiModel[]> => {
  const settings = getSettings()
  const provider = settings.aiProvider as AiProviderId
  const scope = `${provider}:${settings.aiKeyEnc ?? ''}`
  if (cache && cache.scope === scope && Date.now() - cache.at < cache.ttl) return cache.models
  try {
    const live = provider === 'opencode' && !!settings.aiKeyEnc
    const models = live
      ? await zenModels(decrypt(settings.aiKeyEnc!)).catch(() => registryModels(provider))
      : await registryModels(provider)
    cache = { at: Date.now(), ttl: live ? ZEN_TTL_MS : REGISTRY_TTL_MS, scope, models }
    return models
  }
  catch (e) {
    if (cache?.scope === scope) return cache.models
    throw createError({ statusCode: 502, statusMessage: `Could not load the model catalog: ${(e as Error).message}` })
  }
})

// Zen knows the workspace's own model set — models disabled in the Zen
// console are simply absent from its OpenAI-style /models response.
async function zenModels(key: string): Promise<AiModel[]> {
  const res = await fetch('https://opencode.ai/zen/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Zen responded ${res.status}`)
  const data = await res.json() as { data?: { id: string, name?: string }[] }
  if (!data.data?.length) throw new Error('Zen returned no models')
  return data.data
    .map(m => ({
      id: m.id.startsWith('opencode/') ? m.id : `opencode/${m.id}`,
      name: m.name ?? m.id,
      provider: 'OpenCode',
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

interface RegistryProvider {
  name?: string
  models?: Record<string, { name?: string }>
}

async function registryModels(provider: AiProviderId): Promise<AiModel[]> {
  const res = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`models.dev responded ${res.status}`)
  const registry = await res.json() as Record<string, RegistryProvider>
  const entry = registry[provider]
  const label = entry?.name ?? AI_PROVIDERS.find(p => p.id === provider)?.label ?? provider
  return Object.entries(entry?.models ?? {})
    .map(([id, m]) => ({ id: `${provider}/${id}`, name: m.name ?? id, provider: label }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
