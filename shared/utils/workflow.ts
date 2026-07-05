// The workflow step model, shared by the visual builder (app) and the engine
// (server/workflows) so the two sides can't drift. A step is a tagged union the
// runner switches on; adding a block is: extend the union here, handle it in
// the runner, and describe it in app/utils/workflow-steps.ts.

// Per-step metadata. `id` is the step's stable identity: unique within its
// workflow, immutable once assigned (reorders and label edits keep it), and the
// key later steps reference outputs under ({{ steps.<id>.<output> }}). It's
// optional in the type because pre-id definitions exist in the DB — every
// load/save path backfills via ensureStepIds. `label`/`description` are
// builder-only presentation.
export interface StepMeta {
  id?: string
  label?: string
  description?: string
}

export type Step = StepMeta & (
  | { type: 'ddev-start' }
  | { type: 'bash', command: string, continueOnError?: boolean }
  | { type: 'create-branch', name: string }
  | { type: 'create-commit', message: string }
  | { type: 'create-pr', title: string, body: string }
)

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
  'bash': [],
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

// Backfill missing (or duplicated) step ids without touching valid ones.
// Applied on every load/save boundary: the API schemas, the engine's row
// loader, and the workflows GET — so pre-id rows behave as if they had ids.
export function ensureStepIds<S extends StepMeta>(steps: S[]): S[] {
  const declared = new Set(steps.map(s => s.id).filter((id): id is string => !!id))
  const assigned = new Set<string>()
  return steps.map((step) => {
    let id = step.id
    if (!id || assigned.has(id)) {
      id = freeStepId(new Set([...declared, ...assigned]))
    }
    assigned.add(id)
    return step.id === id ? step : { ...step, id }
  })
}

// The id for a step the builder is about to append/insert.
export function nextStepId(steps: StepMeta[]): string {
  return freeStepId(new Set(steps.map(s => s.id).filter((id): id is string => !!id)))
}
