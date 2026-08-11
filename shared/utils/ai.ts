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
  // Gateway provider: one endpoint in front of several model
  // vendors, chosen for its data residency. Not in models.dev, so the ai step
  // declares it to opencode as a custom provider (server/utils/opencode-config.ts).
  { id: 'langdock', label: 'Langdock' },
] as const
export type AiProviderId = typeof AI_PROVIDERS[number]['id']

// Langdock serves per-region deployments; the region is an instance setting
// (its whole point is residency, so it applies to every request).
export const LANGDOCK_REGIONS = ['eu', 'us'] as const
export type LangdockRegion = typeof LANGDOCK_REGIONS[number]

// The OpenAI-compatible route. Langdock also has an Anthropic-compatible one;
// this one carries the full catalog and caches prompts automatically, so it is
// the only route Knecht uses.
export function langdockBaseUrl(region: LangdockRegion): string {
  return `https://api.langdock.com/openai/${region}/v1`
}

// Stored model names are bare, without a provider prefix: the
// instance provider is prepended only at invocation. The charset is shell-safe
// (the ai action splices the final string into a bash command line); a slash
// stays allowed because some catalogs ship slashed ids like 'meta-llama/...'.
export const MODEL_NAME_RE = /^[\w.:-]+(\/[\w.:-]+)*$/

// Strip one leading '<provider>/' from a model stored in the legacy prefixed
// form. Only known provider ids are stripped, so a genuinely slashed model id
// is never mangled. Covers pre-migration values still reaching the runtime
// (old run snapshots get retried, step JSON edited outside the migration).
export function stripLegacyModelPrefix(model: string): string {
  const slash = model.indexOf('/')
  if (slash < 1) return model
  const prefix = model.slice(0, slash)
  return AI_PROVIDERS.some(p => p.id === prefix) ? model.slice(slash + 1) : model
}

// One entry of the `ai` step's model catalog (GET /api/ai-models): a bare
// model name plus the display info the pickers show.
export interface AiModel {
  /** Bare model name, e.g. 'claude-sonnet-4-5' (no provider prefix). */
  id: string
  /** Model display name from the registry, e.g. 'Claude Sonnet 4.5'. */
  name: string
  /** Provider display name, e.g. 'Anthropic'. */
  provider: string
}
