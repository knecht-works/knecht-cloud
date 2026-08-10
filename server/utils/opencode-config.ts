import { type AiProviderId, type LangdockRegion, langdockBaseUrl, stripLegacyModelPrefix } from '../../shared/utils/ai'

// Builds the opencode.json the ai step drops into a run's checkout. Pure
// (no fs, no Nitro) so unit tests can assert the exact config; the writing
// side lives in server/workflows/actions/ai.ts. The container paths are fixed:
// ddev always mounts the checkout at /var/www/html.

// The `instructions` layers, in order: the step's workflow.md prompt and the
// project memory index. Both files are written on every invocation (empty
// when unset), so the array can stay static and every reference always
// resolves.
export const WORKFLOW_SYSTEM_PATH = '/var/www/html/.knecht/opencode/workflow.md'
export const MEMORY_INDEX_PATH = '/var/www/html/.knecht/opencode/memory/MEMORY.md'

export interface OpencodeConfigInput {
  provider: AiProviderId
  region: LangdockRegion
  /** Bare model name this invocation runs (step override already applied). */
  model: string
}

// The subset of opencode's config schema Knecht generates.
export interface OpencodeConfig {
  $schema: string
  instructions: string[]
  provider?: {
    langdock: {
      npm: string
      name: string
      options: { baseURL: string, apiKey: string }
      models: Record<string, object>
    }
  }
}

export function buildOpencodeConfig(input: OpencodeConfigInput): OpencodeConfig {
  const config: OpencodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    instructions: [WORKFLOW_SYSTEM_PATH, MEMORY_INDEX_PATH],
  }
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
        models: { [stripLegacyModelPrefix(input.model)]: {} },
      },
    }
  }
  return config
}
