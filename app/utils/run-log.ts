import type { RunStatus, WorkflowStep } from '~/utils/dashboard'
import type { StepMeta } from '~/utils/workflow-steps'

interface TimelineSource {
  stepId: string
  parentStepId: string | null
  type: string
  origin: 'workflow' | 'followup'
  status: 'running' | 'success' | 'failed' | 'cancelled'
  params: Record<string, unknown> | null
}

export function runLogTimeline<S extends TimelineSource>(rows: S[], runStatus: RunStatus | undefined) {
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
        // Params from an older schema can miss a field meta() reads.
      }
    }
    // The cancel route flips the run first; the step row follows once the action notices the abort.
    const status = s.status === 'running' && runStatus === 'cancelled' ? 'cancelled' : s.status
    return {
      ...s,
      status,
      depth: depthOf(s),
      icon: s.origin === 'followup' ? 'i-lucide-message-circle-reply' : (meta?.icon ?? def?.icon ?? 'i-lucide-square'),
      label: s.origin === 'followup' ? 'Follow-up' : (meta?.label ?? def?.label ?? s.type),
      color: STEP_KIND_COLOR[meta?.kind ?? def?.kind ?? 'det'],
      statusMeta: RUN_STATUS_META[status],
    }
  })
}
