export interface AiProviderSpec {
  id: string
  label: string
  modelsUrl?: string
}

export const AI_PROVIDERS = [
  // Zen and Go share a console key but bill separately: a Go model under 'opencode' fails on a Go-only account.
  { id: 'opencode', label: 'OpenCode Zen', modelsUrl: 'https://opencode.ai/zen/v1/models' },
  { id: 'opencode-go', label: 'OpenCode Go', modelsUrl: 'https://opencode.ai/zen/go/v1/models' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
  { id: 'langdock', label: 'Langdock' },
] as const satisfies readonly AiProviderSpec[]
export type AiProviderId = typeof AI_PROVIDERS[number]['id']

// Preselected in this order once a provider's catalog loads without a default model. The last is the most likely to stay listed.
export const DEFAULT_MODEL_CHOICES: Record<AiProviderId, readonly string[]> = {
  'opencode': ['claude-sonnet-5-5', 'claude-sonnet-5', 'gpt-6.2-sol'],
  'opencode-go': ['kimi-k3.1-pro', 'qwen4-max', 'deepseek-v4.1-flash'],
  'anthropic': ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5-5'],
  'openai': ['gpt-6.2-sol', 'gpt-6.1-sol', 'gpt-6-sol'],
  'google': ['gemini-4-neon', 'gemini-4-carbon', 'gemini-3.8-flash'],
  'langdock': ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5-5'],
}

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

// A step model that stands for the connection's subtask model. MODEL_NAME_RE rejects '@', so no real model collides.
export const SUBTASK_MODEL_REF = '@subtask'

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
