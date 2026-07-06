// The workflow step model, shared by the visual builder (app) and the engine
// (server/workflows) so the two sides can't drift. A step is a tagged union;
// adding a block is: extend the union here, write its action module
// (server/workflows/actions/<type>.ts — schema + execution) and its client def
// (app/utils/steps/<type>.ts — editor fields, outputs, presentation).

// A step's retry policy, applied by the runner around ANY action: up to
// `attempts` total tries, waiting backoffSeconds, then double per retry.
export interface StepRetry {
  /** Total tries (1 = no retry). */
  attempts: number
  /** Wait before the first retry; doubles each further retry (b, 2b, 4b, …). */
  backoffSeconds: number
}

// Per-step metadata. `id` is the step's stable identity: unique within its
// workflow, immutable once assigned (reorders and label edits keep it), and the
// key later steps reference outputs under ({{ steps.<id>.<output> }}). It's
// optional in the type because pre-id definitions exist in the DB — every
// load/save path backfills via ensureStepIds. `label`/`description` are
// builder-only presentation. `continueOnError`/`retry` are the step's error
// policy, enforced generically by the runner for every step type.
export interface StepMeta {
  id?: string
  label?: string
  description?: string
  /** A failing step logs and lets the run continue instead of failing it. */
  continueOnError?: boolean
  retry?: StepRetry
}

// The keys every step shares (StepMeta + the discriminator) — engine code that
// walks a step's OWN params (rendering, run_steps snapshots) skips these.
export const STEP_META_KEYS = ['type', 'id', 'label', 'description', 'continueOnError', 'retry'] as const

// A structured condition row (workflow-engine-plan.md D8): both sides are
// templates rendered against the run context; the operator compares the
// rendered strings (gt/lt coerce to numbers). Deliberately NOT evaluated JS —
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
  | { type: 'ai', prompt: string, system?: string, model?: string }
  // `input` is a template; when it is exactly one {{ ref }} the runner passes
  // the referenced value RAW (object/array), not stringified — see rawParams.
  | { type: 'js', code: string, input?: string }
  | { type: 'http', method: string, url: string, headers?: string, body?: string }
  // Composite control flow: outer conditions array = OR groups, inner = AND.
  | { type: 'if', conditions: Condition[][], then: Step[], else: Step[] }
  // `items` resolves to an array (iterate it) or a number (repeat N times).
  | { type: 'loop', items: string, steps: Step[] }
  | { type: 'create-branch', name: string }
  | { type: 'create-commit', message: string }
  | { type: 'create-pr', title: string, body: string }
)

// Composite steps embed sub-step lists under these keys — the ONE home for
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

// Every step in the tree, depth-first — the step-id namespace is FLAT, so id
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
// URL-safe once encoded — no slash/percent/etc.
export const WORKFLOW_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u

// The lowest free `s<n>` id — deterministic, so backfilling the same stored
// list always produces the same ids even before they're persisted.
function freeStepId(taken: Set<string>): string {
  for (let n = 1; ; n++) {
    if (!taken.has(`s${n}`)) return `s${n}`
  }
}

// Every id declared anywhere in the tree.
function declaredIds(flat: Step[]): Set<string> {
  return new Set(flat.map(s => s.id).filter((id): id is string => !!id))
}

// Backfill missing (or duplicated) step ids without touching valid ones,
// recursing into composite steps — the id namespace is flat across the whole
// tree. Applied on every load/save boundary: the API schemas, the engine's row
// loader, and the workflows GET — so pre-id rows behave as if they had ids.
export function ensureStepIds(steps: Step[]): Step[] {
  const flat = flattenSteps(steps)
  const declared = declaredIds(flat)
  // Fully-idd, duplicate-free trees (the common case on read paths) pass
  // through untouched.
  if (declared.size === flat.length) return steps

  const assigned = new Set<string>()
  let cursor = 1
  const assign = (list: Step[]): Step[] => list.map((step) => {
    let id = step.id
    if (!id || assigned.has(id)) {
      while (declared.has(`s${cursor}`) || assigned.has(`s${cursor}`)) cursor++
      id = `s${cursor}`
    }
    assigned.add(id)
    const next: Step = step.id === id ? step : { ...step, id }
    return mapStepChildren(next, assign)
  })
  return assign(steps)
}

// The id for a step the builder is about to append/insert; `steps` is the
// workflow's ROOT list (ids are unique across the whole tree).
export function nextStepId(steps: Step[]): string {
  return freeStepId(declaredIds(flattenSteps(steps)))
}
