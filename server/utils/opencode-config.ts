import { type AiProviderId, type LangdockRegion, langdockAnthropicBaseUrl, langdockBaseUrl, stripLegacyModelPrefix } from '../../shared/utils/ai'

// Builds the opencode.json the ai step drops into a run's checkout. Pure
// (no fs, no Nitro) so unit tests can assert the exact config; the writing
// side lives in server/workflows/actions/ai.ts. The container paths are fixed:
// ddev always mounts the checkout at /var/www/html.

// The `instructions` layers, in order: the human-written
// rules (instance + project sections in ONE file), the step's workflow.md
// prompt, the project memory index. All files are written on every invocation
// (empty when unset), so the array can stay static and every reference always
// resolves. The two human layers deliberately share one file: opencode
// attaches a prompt-cache breakpoint per instructions entry and Anthropic
// caps cache_control blocks at 4 per request, so a 4-entry array made the
// gateway reject every completion (verified against OpenCode Zen, Aug 2026).
export const RULES_PATH = '/var/www/html/.knecht/opencode/rules.md'
export const WORKFLOW_SYSTEM_PATH = '/var/www/html/.knecht/opencode/workflow.md'
export const MEMORY_INDEX_PATH = '/var/www/html/.knecht/opencode/memory/MEMORY.md'

export interface OpencodeConfigInput {
  provider: AiProviderId
  region: LangdockRegion
  /** Bare model name this invocation runs (step override already applied). */
  model: string
  /** Optional bare model for opencode's internal small tasks; null = unset. */
  subtaskModel: string | null
}

// The subset of opencode's config schema Knecht generates.
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

// Langdock is one gateway with two compatibility routes, and the route depends
// on the model: Claude models speak the Anthropic Messages API, everything
// else the OpenAI one. The user only picks a model; this maps a bare model
// name to the opencode provider key its route is declared under.
export function langdockProviderKey(bareModel: string): 'langdock' | 'langdock-anthropic' {
  return bareModel.startsWith('claude') ? 'langdock-anthropic' : 'langdock'
}

// The `provider/model` reference handed to opencode (--model and small_model).
export function agentModelRef(provider: AiProviderId, bareModel: string): string {
  const key = provider === 'langdock' ? langdockProviderKey(bareModel) : provider
  return `${key}/${bareModel}`
}

// The rules.md content: instance rules first, project rules after (the more
// specific layer wins on conflict). Empty when neither is set.
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
  // opencode's official lever for internal small tasks (title generation,
  // exploration subagents): a faster model than the main one.
  if (input.subtaskModel) config.small_model = agentModelRef(input.provider, models[1]!)
  // Langdock is not in models.dev, so opencode needs the provider declared:
  // the vendor SDK against the region's endpoint, the key via env
  // interpolation (resolveAgentEnv hands LANGDOCK_API_KEY to the process),
  // and a models map registering exactly the models this invocation may use.
  // Each invocation's models are split across the two routes by
  // langdockProviderKey; a block is only emitted when it has models.
  // On the OpenAI route, @ai-sdk/openai (not openai-compatible) because it
  // speaks the Responses API: Langdock's chat/completions route rejects
  // function tools combined with reasoning_effort (GPT-5.x), the responses
  // route accepts both. setCacheKey: false stops opencode from sending
  // prompt_cache_key, which Langdock does not document as a forwarded
  // parameter.
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
