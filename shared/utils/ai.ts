// The providers the `ai` step can hand a key to (server/workflows/actions/
// ai.ts maps each id to its env var). Ids follow models.dev, the registry
// opencode resolves providers from; 'opencode' is Zen.
export const AI_PROVIDERS = [
  // Covers both OpenCode plans (Zen pay-per-use and the Go subscription):
  // either key comes from the OpenCode console and authenticates the same way.
  { id: 'opencode', label: 'OpenCode' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
] as const
export type AiProviderId = typeof AI_PROVIDERS[number]['id']

// One entry of the `ai` step's model catalog (GET /api/ai-models): an opencode
// model ref plus the display info the pickers show.
export interface AiModel {
  /** opencode's provider/model form, e.g. 'anthropic/claude-sonnet-4-5'. */
  id: string
  /** Model display name from the registry, e.g. 'Claude Sonnet 4.5'. */
  name: string
  /** Provider display name, e.g. 'Anthropic'. */
  provider: string
}
