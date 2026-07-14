// The providers the `ai` step can hand a key to (server/workflows/actions/
// ai.ts maps each id to its env var). Ids follow models.dev, the registry
// opencode resolves providers from.
export const AI_PROVIDERS = [
  // OpenCode's two plans share one console key but are DISTINCT providers with
  // separate catalogs and billing: 'opencode' (Zen, pay-per-use credits) and
  // 'opencode-go' (the Go subscription). Running a Go model under 'opencode'
  // would bill Zen credits and fail with "insufficient funds" on a Go-only
  // account, so the user picks the plan they actually pay for.
  { id: 'opencode', label: 'OpenCode Zen' },
  { id: 'opencode-go', label: 'OpenCode Go' },
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
