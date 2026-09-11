export const AI_PROVIDERS = [
  // Zen and Go share a console key but bill separately: a Go model under 'opencode' fails on a Go-only account.
  { id: 'opencode', label: 'OpenCode Zen' },
  { id: 'opencode-go', label: 'OpenCode Go' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
  { id: 'langdock', label: 'Langdock' },
] as const
export type AiProviderId = typeof AI_PROVIDERS[number]['id']

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
