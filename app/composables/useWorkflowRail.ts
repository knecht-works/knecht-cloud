import type { InjectionKey, Ref } from 'vue'
import type { WorkflowStep } from '~/utils/dashboard'
import type { NodeStatus } from '~/utils/step-status'

// Page-global state for the recursive step rail (WorkflowStepList/StepCard):
// structural data (the list, depth, variable scope) flows as props, this
// context carries what every nesting level needs identically. The DnD state
// travels separately (WORKFLOW_DND in useStepDnd).
export interface RailCtx {
  editable: Ref<boolean>
  /** Steps with their settings expanded, tracked by step OBJECT. */
  openSteps: Ref<Set<WorkflowStep>>
  toggleStep: (step: WorkflowStep) => void
  /** The workflow's ROOT step list (ids are unique across the whole tree). */
  root: Ref<WorkflowStep[]>
  /** Run status by step id; empty when no active run. */
  statuses: Ref<Map<string, NodeStatus>>
  /** True after a failed save: issues flag even pristine steps. */
  submitted: Ref<boolean>
}

export const RAIL_CTX = Symbol('rail-ctx') as InjectionKey<RailCtx>
