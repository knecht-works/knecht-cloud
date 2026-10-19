import { type AiModel, type AiProviderId, aiProviderSpec, langdockAnthropicBaseUrl, langdockBaseUrl } from '../../shared/utils/ai'
import type { Settings } from '../db/schema'
import { decrypt } from './crypto'

const LIVE_TTL_MS = 30 * 1000
const REGISTRY_TTL_MS = 60 * 60 * 1000
let cache: { at: number, ttl: number, scope: string, models: AiModel[] } | null = null

export async function loadModelCatalog(settings: Settings): Promise<AiModel[]> {
  const provider = settings.aiProvider as AiProviderId
  const spec = aiProviderSpec(provider)
  const scope = `${provider}:${settings.aiRegion}:${settings.aiKeyEnc ?? ''}`
  if (cache && cache.scope === scope && Date.now() - cache.at < cache.ttl) return cache.models
  try {
    const key = settings.aiKeyEnc ? decrypt(settings.aiKeyEnc) : null
    let live = false
    let models: AiModel[]
    if (provider === 'langdock') {
      if (!key) throw new Error('Langdock lists models only with an API key on file')
      live = true
      models = await langdockModels(settings.aiRegion, key)
    }
    else if (spec?.modelsUrl && key) {
      live = true
      models = await opencodeModels(provider, spec.modelsUrl, spec.label, key).catch(() => registryModels(provider))
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

async function opencodeModels(provider: AiProviderId, url: string, label: string, key: string): Promise<AiModel[]> {
  const data = await fetchModelList(url, key, label)
  return data
    .map(m => ({
      // The plan endpoint may prefix ids with the provider id.
      id: m.id.startsWith(`${provider}/`) ? m.id.slice(provider.length + 1) : m.id,
      name: m.name ?? m.id,
      provider: label,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

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

interface RegistryRoute {
  npm?: string
  api?: string
}

interface RegistryProvider extends RegistryRoute {
  name?: string
  models?: Record<string, { name?: string, provider?: RegistryRoute }>
}

let registryCache: { at: number, registry: Record<string, RegistryProvider> } | null = null

async function loadRegistry(): Promise<Record<string, RegistryProvider>> {
  if (registryCache && Date.now() - registryCache.at < REGISTRY_TTL_MS) return registryCache.registry
  try {
    const res = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`)
    registryCache = { at: Date.now(), registry: await res.json() as Record<string, RegistryProvider> }
    return registryCache.registry
  }
  catch (e) {
    if (!registryCache) throw e
    registryCache.at = Date.now()
    return registryCache.registry
  }
}

// OpenCode Zen and Go serve each model through the API of its maker; models.dev records which.
export async function registryRoute(provider: AiProviderId, model: string): Promise<RegistryRoute> {
  const entry = (await loadRegistry())[provider]
  const route = entry?.models?.[model]?.provider
  return { npm: route?.npm ?? entry?.npm, api: route?.api ?? entry?.api }
}

async function registryModels(provider: AiProviderId): Promise<AiModel[]> {
  const entry = (await loadRegistry())[provider]
  const label = entry?.name ?? aiProviderSpec(provider)?.label ?? provider
  return Object.entries(entry?.models ?? {})
    .map(([id, m]) => ({ id, name: m.name ?? id, provider: label }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
