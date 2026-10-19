export interface AiProviderSpec {
  id: string
  label: string
  keyEnv: readonly string[]
  modelsUrl?: string
}

export const AI_PROVIDERS = [
  // Zen and Go share a console key but bill separately: a Go model under 'opencode' fails on a Go-only account.
  { id: 'opencode', label: 'OpenCode Zen', keyEnv: ['OPENCODE_API_KEY'], modelsUrl: 'https://opencode.ai/zen/v1/models' },
  { id: 'opencode-go', label: 'OpenCode Go', keyEnv: ['OPENCODE_API_KEY'], modelsUrl: 'https://opencode.ai/zen/go/v1/models' },
  { id: 'anthropic', label: 'Anthropic', keyEnv: ['ANTHROPIC_API_KEY'] },
  { id: 'openai', label: 'OpenAI', keyEnv: ['OPENAI_API_KEY'] },
  // Env names follow models.dev; google accepts several, set all.
  { id: 'google', label: 'Google', keyEnv: ['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'] },
  { id: 'langdock', label: 'Langdock', keyEnv: ['LANGDOCK_API_KEY'] },
] as const satisfies readonly AiProviderSpec[]
export type AiProviderId = typeof AI_PROVIDERS[number]['id']

export function aiProviderSpec(id: string): AiProviderSpec | undefined {
  return AI_PROVIDERS.find(p => p.id === id)
}

export const LANGDOCK_REGIONS = ['eu', 'us'] as const
export type LangdockRegion = typeof LANGDOCK_REGIONS[number]

export function langdockBaseUrl(region: LangdockRegion): string {
  return `https://api.langdock.com/openai/${region}/v1`
}

export function langdockAnthropicBaseUrl(region: LangdockRegion): string {
  return `https://api.langdock.com/anthropic/${region}/v1`
}

// Shell-safe charset: the ai action splices this into a bash command line.
export const MODEL_NAME_RE = /^[\w.:-]+(\/[\w.:-]+)*$/

export function stripLegacyModelPrefix(model: string): string {
  const slash = model.indexOf('/')
  if (slash < 1) return model
  const prefix = model.slice(0, slash)
  return AI_PROVIDERS.some(p => p.id === prefix) ? model.slice(slash + 1) : model
}

export interface AiModel {
  id: string
  name: string
  provider: string
}
