import { AI_PROVIDERS, type AiModel, type AiProviderId, langdockAnthropicBaseUrl, langdockBaseUrl } from '../../shared/utils/ai'
import type { Settings } from '../db/schema'
import { decrypt } from './crypto'

// The model catalog for the `ai` step's pickers, scoped to the configured
// provider. Shared by GET /api/ai-models and the settings PATCH (which
// validates a saved model against the catalog). Sources:
// OpenCode plans and Langdock list live from their own /models endpoints
// (they reflect the workspace's model set) with a short TTL; everything else
// comes from the models.dev registry, which changes rarely and keeps a long
// TTL. Cache is keyed to provider + region + key so a settings change
// refetches; a failed refresh serves the stale catalog. All ids are BARE
// model names.
const LIVE_TTL_MS = 30 * 1000
const REGISTRY_TTL_MS = 60 * 60 * 1000
let cache: { at: number, ttl: number, scope: string, models: AiModel[] } | null = null

export async function loadModelCatalog(settings: Settings): Promise<AiModel[]> {
  const provider = settings.aiProvider as AiProviderId
  const scope = `${provider}:${settings.aiRegion}:${settings.aiKeyEnc ?? ''}`
  if (cache && cache.scope === scope && Date.now() - cache.at < cache.ttl) return cache.models
  try {
    const key = settings.aiKeyEnc ? decrypt(settings.aiKeyEnc) : null
    let live = false
    let models: AiModel[]
    if (provider === 'langdock') {
      // No models.dev entry exists for langdock, so the live list (needing a
      // key) is the only source; without a key the pickers degrade to plain
      // text inputs until one is saved.
      if (!key) throw new Error('Langdock lists models only with an API key on file')
      live = true
      models = await langdockModels(settings.aiRegion, key)
    }
    else if (provider in OPENCODE_PLANS && key) {
      live = true
      models = await opencodeModels(provider, key).catch(() => registryModels(provider))
    }
    else {
      models = await registryModels(provider)
    }
    cache = { at: Date.now(), ttl: live ? LIVE_TTL_MS : REGISTRY_TTL_MS, scope, models }
    return models
  }
  catch (e) {
    if (cache?.scope === scope) return cache.models
    throw new Error(`Could not load the model catalog: ${(e as Error).message}`, { cause: e })
  }
}

// Zen and Go are separate OpenCode plans with separate catalogs and billing;
// each plan's endpoint knows the workspace's own model set (models disabled in
// the console are simply absent from its OpenAI-style /models response).
const OPENCODE_PLANS: Partial<Record<AiProviderId, { url: string, label: string }>> = {
  'opencode': { url: 'https://opencode.ai/zen/v1/models', label: 'OpenCode Zen' },
  'opencode-go': { url: 'https://opencode.ai/zen/go/v1/models', label: 'OpenCode Go' },
}

async function opencodeModels(provider: AiProviderId, key: string): Promise<AiModel[]> {
  const plan = OPENCODE_PLANS[provider]!
  const data = await fetchModelList(plan.url, key, plan.label)
  return data
    .map(m => ({
      // Catalog ids are bare model names; the plan endpoint
      // may return them prefixed with the provider id.
      id: m.id.startsWith(`${provider}/`) ? m.id.slice(provider.length + 1) : m.id,
      name: m.name ?? m.id,
      provider: plan.label,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

// Langdock lists its catalog per compatibility route: Claude models on the
// Anthropic route, everything else on the OpenAI one. Merge both so the picker
// shows the workspace's full set; one route without models for this workspace
// (a vendor disabled in the Langdock console) must not sink the other.
async function langdockModels(region: Settings['aiRegion'], key: string): Promise<AiModel[]> {
  const results = await Promise.allSettled([
    fetchModelList(`${langdockBaseUrl(region)}/models`, key, 'Langdock'),
    fetchModelList(`${langdockAnthropicBaseUrl(region)}/models`, key, 'Langdock'),
  ])
  const lists = results.filter(r => r.status === 'fulfilled').map(r => r.value)
  if (!lists.length) throw (results[0] as PromiseRejectedResult).reason
  const byId = new Map<string, AiModel>()
  for (const m of lists.flat()) {
    if (!byId.has(m.id)) byId.set(m.id, { id: m.id, name: m.name ?? m.display_name ?? m.id, provider: 'Langdock' })
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// Both list shapes are { data: [{ id, ... }] }; the OpenAI-style sources name
// a model via `name`, the Anthropic route via `display_name`.
async function fetchModelList(url: string, key: string, label: string): Promise<{ id: string, name?: string, display_name?: string }[]> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`${label} responded ${res.status}`)
  const data = await res.json() as { data?: { id: string, name?: string, display_name?: string }[] }
  if (!data.data?.length) throw new Error(`${label} returned no models`)
  return data.data
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
    .map(([id, m]) => ({ id, name: m.name ?? id, provider: label }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
