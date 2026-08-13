import type { WorkflowStep } from '~/utils/dashboard'
import type { StepMeta } from '~/utils/workflow-steps'

// The minimal run_steps fields the timeline mapping reads; callers pass their
// full API rows and keep the extra fields through the spread.
interface TimelineSource {
  stepId: string
  parentStepId: string | null
  type: string
  origin: 'workflow' | 'followup'
  status: 'running' | 'success' | 'failed'
  params: Record<string, unknown> | null
}

// The step timeline behind KRunLog: one row per executed step (run_steps),
// presented via the step registry exactly like the workflow editor's rail
// (per-type label and icon, derived from the row's RENDERED params, so e.g. a
// bash step is titled by what its command does). What a step executed stays
// in its log slice: every slice begins with the '▶' banner line. Unknown step
// types (e.g. removed ones) render generically; nested rows indent by their
// ancestor count (parentStepId chains).
export function runLogTimeline<S extends TimelineSource>(rows: S[]) {
  const byStepId = new Map(rows.map(r => [r.stepId, r]))
  const depthOf = (row: S) => {
    let depth = 0
    for (let p = row.parentStepId; p; p = byStepId.get(p)?.parentStepId ?? null) depth++
    return depth
  }
  return rows.map((s) => {
    const def = stepDefFor(s.type)
    let meta: StepMeta | null = null
    if (def) {
      try {
        meta = workflowStepMeta({ type: s.type, ...(s.params ?? {}) } as unknown as WorkflowStep)
      }
      catch {
        // Params from an older schema can miss a field a meta() reads; the
        // def's own identity still renders below.
      }
    }
    return {
      ...s,
      depth: depthOf(s),
      icon: s.origin === 'followup' ? 'i-lucide-message-circle-reply' : (meta?.icon ?? def?.icon ?? 'i-lucide-square'),
      label: s.origin === 'followup' ? 'Follow-up' : (meta?.label ?? def?.label ?? s.type),
      color: STEP_KIND_COLOR[meta?.kind ?? def?.kind ?? 'det'],
      statusMeta: RUN_STATUS_META[s.status],
    }
  })
}
