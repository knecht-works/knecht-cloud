// The workflow step model, shared by the visual builder (app) and the engine
// (server/workflows) so the two sides can't drift. A step is a tagged union;
// adding a block is: extend the union here, write its action module
// (server/workflows/actions/<type>.ts: schema + execution) and its client def
// (app/utils/steps/<type>.ts: editor fields, outputs, presentation).

// How long one attempt of an action may run before the runner fails it
// (StepMeta.timeoutSeconds overrides per step).
export const DEFAULT_STEP_TIMEOUT_SECONDS = 600

// A step's retry policy, applied by the runner around ANY action: up to
// `attempts` total tries, waiting backoffSeconds, then double per retry.
export interface StepRetry {
  /** Total tries (1 = no retry). */
  attempts: number
  /** Wait before the first retry; doubles each further retry (b, 2b, 4b, …). */
  backoffSeconds: number
}

// Per-step metadata. `id` is the step's stable identity: unique within its
// workflow (the namespace is flat across the whole tree) and the key later
// steps reference outputs under ({{ steps.<id>.<output> }}). It's derived from
// the label at creation (deriveStepId: "Run command" → run_command), follows
// label edits while still auto-derived, and is hand-editable in the builder;
// both rename paths rewrite the workflow's references (renameStepReferences),
// reorders never touch it. It's optional in the type because pre-id
// definitions exist in the DB. Every load/save path backfills via
// ensureStepIds. `label`/`description` are builder-only presentation.
// `continueOnError`/`timeoutSeconds`/`retry` are the step's error policy,
// enforced generically by the runner for every action (composite if/loop
// steps carry no timeout; their sub-steps each have their own).
export interface StepMeta {
  id?: string
  label?: string
  description?: string
  /** A failing step logs and lets the run continue instead of failing it. */
  continueOnError?: boolean
  /** Max seconds per attempt (DEFAULT_STEP_TIMEOUT_SECONDS when unset). */
  timeoutSeconds?: number
  retry?: StepRetry
}

// The keys every step shares (StepMeta + the discriminator). Engine code that
// walks a step's OWN params (rendering, run_steps snapshots) skips these.
export const STEP_META_KEYS = ['type', 'id', 'label', 'description', 'continueOnError', 'timeoutSeconds', 'retry'] as const

// A structured condition row (workflow-engine-plan.md D8): both sides are
// templates rendered against the run context; the operator compares the
// rendered strings (gt/lt coerce to numbers). Deliberately NOT evaluated JS:
// user code belongs in the sandboxed js step, not the control plane.
export const CONDITION_OPS = ['eq', 'neq', 'contains', 'not-contains', 'empty', 'not-empty', 'gt', 'lt', 'regex'] as const
export type ConditionOp = typeof CONDITION_OPS[number]

export interface Condition {
  left: string
  op: ConditionOp
  /** Unused for empty/not-empty; missing means ''. */
  right?: string
}

export type Step = StepMeta & (
  | { type: 'ddev-start' }
  | { type: 'bash', command: string }
  // `system` is a per-step system prompt, merged with the sandbox's baked-in
  // instructions. `output` is a field spec (`name: type` per line) that turns
  // the agent's answer into a validated steps.<id>.json (see actions/ai.ts).
  | { type: 'ai', prompt: string, model?: string, system?: string, output?: string }
  // `input` is a template; when it is exactly one {{ ref }} the runner passes
  // the referenced value RAW (object/array), not stringified (see rawParams).
  | { type: 'js', code: string, input?: string }
  | { type: 'http', method: string, url: string, headers?: string, body?: string }
  // Composite control flow: outer conditions array = OR groups, inner = AND.
  | { type: 'if', conditions: Condition[][], then: Step[], else: Step[] }
  // `items` resolves to an array (iterate it) or a number (repeat N times).
  | { type: 'loop', items: string, steps: Step[] }
  // Requests every page of a sitemap (or of an explicit URL list: newline-
  // separated, or a raw {{ ref }} to an array like a previous link-check's
  // brokenUrls) and reports HTTP errors. `failOnBroken` (default true) turns
  // broken pages into a step failure; off, the step just returns the counts.
  | { type: 'link-check', sitemap?: string, urls?: string, failOnBroken?: boolean }
  | { type: 'create-branch', name: string }
  | { type: 'create-commit', message: string }
  | { type: 'create-pr', title: string, body: string }
)

// Composite steps embed sub-step lists under these keys: the ONE home for
// that knowledge. stepChildren/mapStepChildren, id backfill, validation, the
// runner and the builder all derive from it; a new composite type only extends
// this map (plus its schema in server/workflows/schema.ts).
export const COMPOSITE_CHILD_KEYS = {
  if: ['then', 'else'],
  loop: ['steps'],
} as const satisfies Partial<Record<Step['type'], readonly string[]>>

export type CompositeStep = Extract<Step, { type: keyof typeof COMPOSITE_CHILD_KEYS }>

export function isComposite(step: Step): step is CompositeStep {
  return isCompositeType(step.type)
}

export function isCompositeType(type: Step['type']): type is CompositeStep['type'] {
  return type in COMPOSITE_CHILD_KEYS
}

// A composite step's sub-step lists ([] for plain steps).
export function stepChildren(step: Step): Step[][] {
  if (!isComposite(step)) return []
  const record = step as unknown as Record<string, Step[]>
  return COMPOSITE_CHILD_KEYS[step.type].map(key => record[key]!)
}

// A copy of the step with every child list passed through `fn` (the step
// itself when it has none).
export function mapStepChildren(step: Step, fn: (children: Step[]) => Step[]): Step {
  if (!isComposite(step)) return step
  const record = step as unknown as Record<string, Step[]>
  const patch = Object.fromEntries(COMPOSITE_CHILD_KEYS[step.type].map(key => [key, fn(record[key]!)]))
  return { ...step, ...patch }
}

// Every step in the tree, depth-first. The step-id namespace is FLAT, so id
// uniqueness and lookups always work on this.
export function flattenSteps(steps: Step[]): Step[] {
  return steps.flatMap(step => [step, ...flattenSteps(stepChildren(step).flat())])
}

// Nesting is capped to keep the builder and variable scoping comprehensible.
export const MAX_STEP_DEPTH = 3

export function stepTreeDepth(steps: Step[]): number {
  let max = 0
  for (const step of steps) {
    const children = stepChildren(step)
    const depth = 1 + (children.length ? Math.max(...children.map(stepTreeDepth)) : 0)
    if (depth > max) max = depth
  }
  return max
}

// A workflow name doubles as its URL segment and the `runs.workflow` reference.
// It's a free-form friendly name (spaces allowed), constrained only to what's
// URL-safe once encoded: no slash/percent/etc.
export const WORKFLOW_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u

// Every id declared anywhere in the tree.
function declaredIds(flat: Step[]): Set<string> {
  return new Set(flat.map(s => s.id).filter((id): id is string => !!id))
}

// Backfill missing (or duplicated) step ids without touching valid ones,
// recursing into composite steps: the id namespace is flat across the whole
// tree. Ids derive from the step's label (or its type), so backfilled
// definitions read like builder-created ones; deterministic, so the same
// stored list always produces the same ids even before they're persisted.
// Applied on every load/save boundary: the API schemas, the engine's row
// loader, and the workflows GET.
export function ensureStepIds(steps: Step[]): Step[] {
  const flat = flattenSteps(steps)
  const declared = declaredIds(flat)
  // Fully-idd, duplicate-free trees (the common case on read paths) pass
  // through untouched.
  if (declared.size === flat.length) return steps

  const assigned = new Set<string>()
  const assign = (list: Step[]): Step[] => list.map((step) => {
    let id = step.id
    if (!id || assigned.has(id)) {
      id = deriveStepId(step.label || step.type, new Set([...declared, ...assigned]))
    }
    assigned.add(id)
    const next: Step = step.id === id ? step : { ...step, id }
    return mapStepChildren(next, assign)
  })
  return assign(steps)
}

// ── step ids ─────────────────────────────────────────────────────────────────
// A step id is the `steps.<id>` segment of template references, so it must fit
// render()'s `[\w.]+` path grammar: word chars only (dots are the path
// separator, hyphens don't match). Shared by the server schema and the
// builder's id editor.
export const STEP_ID_RE = /^[a-z][a-z0-9_]*$/

// Label → id slug, GitHub-Actions style: "Run Lighthouse" → run_lighthouse.
// '' when nothing survives (emoji-only labels); deriveStepId falls back then.
export function slugifyStepId(label: string): string {
  const base = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!base) return ''
  // Leading digit ("3rd check") gets a letter prefix; cap the length so
  // collision suffixes stay readable.
  return (/^[a-z]/.test(base) ? base : `s_${base}`).slice(0, 40).replace(/_+$/, '')
}

// Every id declared in the tree: what a new or renamed id must stay unique
// against. `steps` is the workflow's ROOT list (the namespace is flat).
export function stepIds(steps: Step[]): Set<string> {
  return declaredIds(flattenSteps(steps))
}

// The id for a new, relabeled or backfilled step: the label's slug (`step`
// when it slugs to nothing), `_2`-suffixed on collision.
export function deriveStepId(label: string, taken: Set<string>): string {
  const slug = slugifyStepId(label) || 'step'
  if (!taken.has(slug)) return slug
  for (let n = 2; ; n++) {
    if (!taken.has(`${slug}_${n}`)) return `${slug}_${n}`
  }
}

// Whether `id` is (still) the auto-derived id for `label`: the slug itself or
// a collision-suffixed variant. The builder keeps such ids in sync with label
// edits (checking the label AND the type, backfill's base) and leaves
// hand-edited ones alone.
export function isDerivedStepId(id: string, label: string): boolean {
  const slug = slugifyStepId(label) || 'step'
  return id === slug || (id.startsWith(`${slug}_`) && /^\d+$/.test(id.slice(slug.length + 1)))
}

// Rewrite every `{{ steps.<oldId>… }}` reference in the tree to the new id:
// string params and nested param shapes (if conditions), composite bodies
// included. Mutates the steps in place (the editor's draft owns the state).
export function renameStepReferences(steps: Step[], oldId: string, newId: string): void {
  const re = new RegExp(`(\\{\\{\\s*steps\\.)${oldId}(?=[.\\s}])`, 'g')
  const rewrite = (text: string) => text.replace(re, `$1${newId}`)
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'string') (value as unknown[])[i] = rewrite(item)
        else walk(item)
      })
    }
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const [key, item] of Object.entries(record)) {
        if (typeof item === 'string') record[key] = rewrite(item)
        else walk(item)
      }
    }
  }
  for (const step of flattenSteps(steps)) {
    // Sub-step lists are covered by flattenSteps; meta strings hold no
    // templates.
    const skip = new Set<string>([...STEP_META_KEYS, ...(isComposite(step) ? COMPOSITE_CHILD_KEYS[step.type] : [])])
    const record = step as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (skip.has(key)) continue
      if (typeof value === 'string') record[key] = rewrite(value)
      else walk(value)
    }
  }
}

// ── ai step: structured output spec ──────────────────────────────────────────
// An ai step's `output` param declares the JSON it must return, one
// `name: type` per line. Shared so the engine (validate the spec, build the
// schema), the builder (offer steps.<id>.json.<field> as variables) and
// import/export all read the exact same grammar.
export const AI_OUTPUT_TYPES = ['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]'] as const
export type AiOutputType = typeof AI_OUTPUT_TYPES[number]
export interface AiOutputField { name: string, type: AiOutputType }

// One line → a field, an Error explaining why it's malformed, or null (blank).
function parseAiOutputLine(raw: string): AiOutputField | Error | null {
  const line = raw.trim()
  if (!line) return null
  const colon = line.indexOf(':')
  if (colon === -1) return new Error(`Invalid output field '${line}': expected 'name: type'`)
  const name = line.slice(0, colon).trim()
  const type = line.slice(colon + 1).trim()
  if (!/^\w+$/.test(name)) return new Error(`Invalid output field name '${name}': use letters, digits, underscore`)
  if (!(AI_OUTPUT_TYPES as readonly string[]).includes(type)) {
    return new Error(`Invalid type '${type}' for '${name}': use one of ${AI_OUTPUT_TYPES.join(', ')}`)
  }
  return { name, type: type as AiOutputType }
}

// Strict: every non-blank line must be a valid field and there must be at least
// one; throws the first offending line's error. The engine's validation path.
export function parseAiOutputSpec(spec: string): AiOutputField[] {
  const fields: AiOutputField[] = []
  for (const raw of spec.split('\n')) {
    const parsed = parseAiOutputLine(raw)
    if (parsed instanceof Error) throw parsed
    if (parsed) fields.push(parsed)
  }
  if (!fields.length) throw new Error('output defines no fields')
  return fields
}

// Tolerant: the well-formed fields only, ignoring blanks and half-typed lines,
// never throws. Lets the builder offer field variables while the spec is still
// being typed.
export function aiOutputFields(spec: string): AiOutputField[] {
  const fields: AiOutputField[] = []
  for (const raw of spec.split('\n')) {
    const parsed = parseAiOutputLine(raw)
    if (parsed && !(parsed instanceof Error)) fields.push(parsed)
  }
  return fields
}
