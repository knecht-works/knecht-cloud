// The workflow step model, shared by the visual builder (app) and the engine
// (server/workflows) so the two sides can't drift. A step is a tagged union the
// runner switches on; adding a block is: extend the union here, handle it in
// the runner, and describe it in app/utils/workflow-steps.ts.

// Optional per-step metadata the visual builder can set: a custom display name
// (`label`) and a note (`description`). They don't affect execution — they're
// just for the builder/overview.
export interface StepMeta {
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
  /** Template path, e.g. 'branch.name' → {{ branch.name }} */
  path: string
  hint: string
}

// What each step type writes into the run context, keyed by step type.
export const STEP_OUTPUTS: Record<Step['type'], StepVar[]> = {
  'ddev-start': [
    { path: 'preview.url', hint: 'The booted environment\'s preview URL' },
  ],
  'bash': [],
  'create-branch': [
    { path: 'branch.name', hint: 'The created branch' },
  ],
  'create-commit': [
    { path: 'commit.sha', hint: 'The commit\'s SHA (empty when nothing changed)' },
  ],
  'create-pr': [
    { path: 'pr.url', hint: 'The opened pull request' },
    { path: 'pr.number', hint: 'Its number' },
  ],
}
