// Per-step run status for the builder rail: the status vocabulary, its card
// treatments, the run-rows-to-tree status mapping, and the issue summary
// line. Shared by the rail cards and the page banner.
// Runtime-import-free on purpose (type imports only): buildStatusMap is unit
// tested in plain node vitest, which resolves no Nuxt auto-imports.
import type { Step } from '#shared/utils/workflow'

export type StepStatus = 'idle' | 'selected' | 'done' | 'running' | 'error' | 'pending' | 'skipped'

// What a rail card renders for one step during a run; `runs` counts the loop
// iterations observed so far (only set for direct children of a loop).
export interface NodeStatus { status: StepStatus, runs?: number }

// The slice of a run_steps row the mapping needs (TestRunStepRow satisfies it).
export interface RunStepRowLike {
  stepId: string
  status: 'running' | 'success' | 'failed'
}

/**
 * Maps the run's polled step rows onto the draft tree, keyed by step id (the
 * id namespace is flat and tree-unique; stepIndex is ambiguous across nesting
 * levels). Steps without rows get their status inferred: the runner emits
 * nothing for not-taken if branches and never-reached steps, so "skipped" is
 * inference, not data. Empty map when there is no active run (the cards then
 * fall back to idle/selected).
 */
export function buildStatusMap(
  steps: Step[],
  run: { status: string } | null,
  rows: RunStepRowLike[],
): Map<string, NodeStatus> {
  const map = new Map<string, NodeStatus>()
  if (!run) return map

  const byStep = new Map<string, RunStepRowLike[]>()
  for (const row of rows) {
    const bucket = byStep.get(row.stepId)
    if (bucket) bucket.push(row)
    else byStep.set(row.stepId, [row])
  }

  // A step with rows (several for loop iterations): still going beats failed
  // beats done, so a loop child reads "running" while iteration 3 runs even
  // if iteration 1 failed (continueOnError).
  const fromRows = (stepRows: RunStepRowLike[]): StepStatus =>
    stepRows.some(r => r.status === 'running')
      ? 'running'
      : stepRows.some(r => r.status === 'failed') ? 'error' : 'done'

  // A row-less nested step is skipped once its fate is sealed (the parent
  // finished without reaching it, or the sibling branch ran); until then the
  // run may still get there: pending.
  const noRowStatus = (parentStatus: StepStatus, sealed: boolean): StepStatus =>
    sealed || parentStatus === 'done' || parentStatus === 'error' || parentStatus === 'skipped'
      ? 'skipped'
      : 'pending'

  const walkList = (list: Step[], parentStatus: StepStatus, otherBranchTaken: boolean, inLoop: boolean) => {
    for (const child of list) {
      const childRows = child.id ? byStep.get(child.id) : undefined
      const status = childRows ? fromRows(childRows) : noRowStatus(parentStatus, otherBranchTaken)
      visit(child, status, inLoop && childRows ? childRows.length : undefined)
    }
  }

  const visit = (step: Step, status: StepStatus, runs?: number) => {
    if (step.id) map.set(step.id, runs != null ? { status, runs } : { status })
    if (step.type === 'if') {
      const taken = (branch: Step[]) => branch.some(c => c.id != null && byStep.has(c.id))
      walkList(step.then, status, taken(step.else), false)
      walkList(step.else, status, taken(step.then), false)
    }
    else if (step.type === 'loop') {
      walkList(step.steps, status, false, true)
    }
  }

  for (const step of steps) {
    const stepRows = step.id ? byStep.get(step.id) : undefined
    visit(step, stepRows ? fromRows(stepRows) : (run.status === 'failed' ? 'skipped' : 'pending'))
  }
  return map
}

// status → card treatment (border / background / left accent / dim)
export const TREAT: Record<StepStatus, { border: string, bg: string, accent: string | null, dim?: boolean }> = {
  idle: { border: 'var(--border-default)', bg: 'var(--surface-muted)', accent: null },
  selected: { border: 'var(--border-accented)', bg: 'var(--surface-muted)', accent: null },
  done: { border: 'var(--border-default)', bg: 'var(--surface-muted)', accent: 'var(--primary)' },
  running: { border: 'var(--accent-orange)', bg: 'color-mix(in oklab, var(--accent-orange) 10%, var(--surface-muted))', accent: 'var(--accent-orange)' },
  error: { border: 'var(--status-error)', bg: 'color-mix(in oklab, var(--status-error) 8%, var(--surface-muted))', accent: 'var(--status-error)' },
  pending: { border: 'var(--border-muted)', bg: 'color-mix(in oklab, var(--surface-muted) 60%, transparent)', accent: null, dim: true },
  skipped: { border: 'var(--border-muted)', bg: 'transparent', accent: null, dim: true },
}

export const STATUS_LABEL: Partial<Record<StepStatus, { text: string, color: string }>> = {
  running: { text: 'running', color: 'var(--accent-orange)' },
  done: { text: 'done', color: 'var(--text-primary)' },
  error: { text: 'failed', color: 'var(--status-error)' },
  skipped: { text: 'skipped', color: 'var(--text-dimmed)' },
}

// The card's one-line problem summary ("Command is required · +2 more"),
// naming the sub-step when the problem sits inside a composite.
export function issueSummary(r: { step: WorkflowStep, issues: StepIssue[] }): string {
  const first = r.issues[0]!
  const text = first.step === r.step ? first.message : `${workflowStepMeta(first.step).label}: ${first.message}`
  return r.issues.length > 1 ? `${text} · +${r.issues.length - 1} more` : text
}
