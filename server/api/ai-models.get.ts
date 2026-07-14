import { AI_PROVIDERS, type AiModel, type AiProviderId } from '#shared/utils/ai'
import { getSettings } from '../utils/settings'
import { decrypt } from '../utils/crypto'

// GET /api/ai-models → the model catalog for the `ai` step's pickers, scoped
// to the configured provider. For OpenCode (Zen or Go) with a key on file the
// list comes from the plan's own /models endpoint (it reflects models disabled
// for the workspace) and is cached only briefly, so toggling a model over there
// shows up on the next page load; the models.dev registry (everything else,
// and the OpenCode fallback) changes rarely and keeps a long TTL. Cache is
// keyed to provider + key so a settings change refetches; a failed refresh
// serves the stale catalog.
const ZEN_TTL_MS = 30 * 1000
const REGISTRY_TTL_MS = 60 * 60 * 1000
let cache: { at: number, ttl: number, scope: string, models: AiModel[] } | null = null

export default defineEventHandler(async (): Promise<AiModel[]> => {
  const settings = getSettings()
  const provider = settings.aiProvider as AiProviderId
  const scope = `${provider}:${settings.aiKeyEnc ?? ''}`
  if (cache && cache.scope === scope && Date.now() - cache.at < cache.ttl) return cache.models
  try {
    const live = provider in OPENCODE_PLANS && !!settings.aiKeyEnc
    const models = live
      ? await opencodeModels(provider, decrypt(settings.aiKeyEnc!)).catch(() => registryModels(provider))
      : await registryModels(provider)
    cache = { at: Date.now(), ttl: live ? ZEN_TTL_MS : REGISTRY_TTL_MS, scope, models }
    return models
  }
  catch (e) {
    if (cache?.scope === scope) return cache.models
    throw createError({ statusCode: 502, statusMessage: `Could not load the model catalog: ${(e as Error).message}` })
  }
})

// Zen and Go are separate OpenCode plans with separate catalogs and billing;
// each plan's endpoint knows the workspace's own model set (models disabled in
// the console are simply absent from its OpenAI-style /models response).
const OPENCODE_PLANS: Partial<Record<AiProviderId, { url: string, label: string }>> = {
  'opencode': { url: 'https://opencode.ai/zen/v1/models', label: 'OpenCode Zen' },
  'opencode-go': { url: 'https://opencode.ai/zen/go/v1/models', label: 'OpenCode Go' },
}

async function opencodeModels(provider: AiProviderId, key: string): Promise<AiModel[]> {
  const plan = OPENCODE_PLANS[provider]!
  const res = await fetch(plan.url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`${plan.label} responded ${res.status}`)
  const data = await res.json() as { data?: { id: string, name?: string }[] }
  if (!data.data?.length) throw new Error(`${plan.label} returned no models`)
  return data.data
    .map(m => ({
      id: m.id.startsWith(`${provider}/`) ? m.id : `${provider}/${m.id}`,
      name: m.name ?? m.id,
      provider: plan.label,
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
