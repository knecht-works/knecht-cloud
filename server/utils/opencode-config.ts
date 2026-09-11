import { type AiProviderId, type LangdockRegion, langdockAnthropicBaseUrl, langdockBaseUrl, stripLegacyModelPrefix } from '../../shared/utils/ai'

// Instance and project rules share ONE file: opencode adds a prompt-cache breakpoint
// per instructions entry and Anthropic caps cache_control blocks at 4 per request.
export const RULES_PATH = '/var/www/html/.knecht/opencode/rules.md'
export const WORKFLOW_SYSTEM_PATH = '/var/www/html/.knecht/opencode/workflow.md'
export const MEMORY_INDEX_PATH = '/var/www/html/.knecht/opencode/memory/MEMORY.md'

export interface OpencodeConfigInput {
  provider: AiProviderId
  region: LangdockRegion
  model: string
  subtaskModel: string | null
}

export interface OpencodeConfig {
  $schema: string
  instructions: string[]
  small_model?: string
  provider?: Record<string, {
    npm: string
    name: string
    options: { baseURL: string, apiKey: string, setCacheKey?: false }
    models: Record<string, object>
  }>
}

export function langdockProviderKey(bareModel: string): 'langdock' | 'langdock-anthropic' {
  return bareModel.startsWith('claude') ? 'langdock-anthropic' : 'langdock'
}

export function agentModelRef(provider: AiProviderId, bareModel: string): string {
  const key = provider === 'langdock' ? langdockProviderKey(bareModel) : provider
  return `${key}/${bareModel}`
}

export function buildAgentRules(instance: string, project: string): string {
  const sections: string[] = []
  if (instance.trim()) sections.push(`# Instance rules\n\n${instance.trim()}`)
  if (project.trim()) sections.push(`# Project rules\n\nOn conflict these override the instance rules.\n\n${project.trim()}`)
  return sections.length ? `${sections.join('\n\n')}\n` : ''
}

export function buildOpencodeConfig(input: OpencodeConfigInput): OpencodeConfig {
  const config: OpencodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    instructions: [RULES_PATH, WORKFLOW_SYSTEM_PATH, MEMORY_INDEX_PATH],
  }
  const models = [input.model, ...(input.subtaskModel ? [input.subtaskModel] : [])]
    .map(stripLegacyModelPrefix)
  if (input.subtaskModel) config.small_model = agentModelRef(input.provider, models[1]!)
  // @ai-sdk/openai, not openai-compatible: Langdock's chat/completions route rejects
  // function tools combined with reasoning_effort (GPT-5.x); the Responses API accepts both.
  if (input.provider === 'langdock') {
    config.provider = {}
    const openai = models.filter(m => langdockProviderKey(m) === 'langdock')
    const anthropic = models.filter(m => langdockProviderKey(m) === 'langdock-anthropic')
    if (openai.length) {
      config.provider.langdock = {
        npm: '@ai-sdk/openai',
        name: 'Langdock',
        options: {
          baseURL: langdockBaseUrl(input.region),
          apiKey: '{env:LANGDOCK_API_KEY}',
          setCacheKey: false,
        },
        models: Object.fromEntries(openai.map(m => [m, {}])),
      }
    }
    if (anthropic.length) {
      config.provider['langdock-anthropic'] = {
        npm: '@ai-sdk/anthropic',
        name: 'Langdock (Anthropic)',
        options: {
          baseURL: langdockAnthropicBaseUrl(input.region),
          apiKey: '{env:LANGDOCK_API_KEY}',
        },
        models: Object.fromEntries(anthropic.map(m => [m, {}])),
      }
    }
  }
  return config
}
