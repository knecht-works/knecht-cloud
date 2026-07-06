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
