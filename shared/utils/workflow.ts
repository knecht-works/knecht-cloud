// The workflow step model, shared by the visual builder (app) and the engine
// (server/workflows) so the two sides can't drift. A step is a tagged union the
// runner switches on; adding a block is: extend the union here, handle it in
// the runner, and describe it in app/utils/workflow-steps.ts.

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

// Composite steps embed sub-step lists the engine recurses into.
export function stepChildren(step: Step): Step[][] {
  if (step.type === 'if') return [step.then, step.else]
  if (step.type === 'loop') return [step.steps]
  return []
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

// A variable a step contributes to the run context for later steps. Shared so
// the builder's autocomplete and the engine describe step outputs in one place.
export interface StepVar {
  /** Output name relative to the step, e.g. 'name' → {{ steps.<id>.name }} */
  path: string
  hint: string
}

// What each step type writes into the run context, keyed by step type.
export const STEP_OUTPUTS: Record<Step['type'], StepVar[]> = {
  'ddev-start': [
    { path: 'url', hint: 'The booted environment\'s preview URL' },
  ],
  'bash': [
    { path: 'stdout', hint: 'The command\'s output (tail)' },
    { path: 'exitCode', hint: 'The exit code (0 on success)' },
  ],
  'ai': [
    { path: 'text', hint: 'The model\'s response' },
    { path: 'json', hint: 'The response parsed as JSON (when it is valid JSON)' },
  ],
  'js': [
    { path: 'result', hint: 'What main() returned' },
  ],
  'http': [
    { path: 'status', hint: 'The HTTP status code' },
    { path: 'body', hint: 'The response body (parsed JSON when possible)' },
  ],
  'if': [
    { path: 'matched', hint: 'Whether the conditions matched (then ran)' },
  ],
  'loop': [
    { path: 'results', hint: 'Per-iteration outputs of the loop\'s steps' },
    { path: 'count', hint: 'How many iterations ran' },
  ],
  'create-branch': [
    { path: 'name', hint: 'The created branch' },
  ],
  'create-commit': [
    { path: 'sha', hint: 'The commit\'s SHA (empty when nothing changed)' },
  ],
  'create-pr': [
    { path: 'url', hint: 'The opened pull request' },
    { path: 'number', hint: 'Its number' },
  ],
}

// The lowest free `s<n>` id — deterministic, so backfilling the same stored
// list always produces the same ids even before they're persisted.
function freeStepId(taken: Set<string>): string {
  for (let n = 1; ; n++) {
    if (!taken.has(`s${n}`)) return `s${n}`
  }
}

// Backfill missing (or duplicated) step ids without touching valid ones,
// recursing into composite steps — the id namespace is flat across the whole
// tree. Applied on every load/save boundary: the API schemas, the engine's row
// loader, and the workflows GET — so pre-id rows behave as if they had ids.
export function ensureStepIds(steps: Step[]): Step[] {
  const declared = new Set(flattenSteps(steps).map(s => s.id).filter((id): id is string => !!id))
  const assigned = new Set<string>()
  const assign = (list: Step[]): Step[] => list.map((step) => {
    let id = step.id
    if (!id || assigned.has(id)) {
      id = freeStepId(new Set([...declared, ...assigned]))
    }
    assigned.add(id)
    let next: Step = step.id === id ? step : { ...step, id }
    if (next.type === 'if') next = { ...next, then: assign(next.then), else: assign(next.else) }
    if (next.type === 'loop') next = { ...next, steps: assign(next.steps) }
    return next
  })
  return assign(steps)
}

// The id for a step the builder is about to append/insert; `steps` is the
// workflow's ROOT list (ids are unique across the whole tree).
export function nextStepId(steps: Step[]): string {
  return freeStepId(new Set(flattenSteps(steps).map(s => s.id).filter((id): id is string => !!id)))
}
