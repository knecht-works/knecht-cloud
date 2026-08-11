import { type AiProviderId, type LangdockRegion, langdockBaseUrl, stripLegacyModelPrefix } from '../../shared/utils/ai'

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
  provider?: {
    langdock: {
      npm: string
      name: string
      options: { baseURL: string, apiKey: string }
      models: Record<string, object>
    }
  }
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
  if (input.subtaskModel) config.small_model = `${input.provider}/${models[1]}`
  // Langdock is not in models.dev, so opencode needs the provider declared:
  // the OpenAI-compatible SDK against the region's endpoint, the key via env
  // interpolation (resolveAgentEnv hands LANGDOCK_API_KEY to the process),
  // and a models map registering exactly the models this invocation may use.
  if (input.provider === 'langdock') {
    config.provider = {
      langdock: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Langdock',
        options: {
          baseURL: langdockBaseUrl(input.region),
          apiKey: '{env:LANGDOCK_API_KEY}',
        },
        models: Object.fromEntries(models.map(m => [m, {}])),
      },
    }
  }
  return config
}
