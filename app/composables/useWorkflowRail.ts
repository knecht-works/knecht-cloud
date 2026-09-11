import type { InjectionKey, Ref } from 'vue'
import type { WorkflowStep } from '~/utils/dashboard'
import type { NodeStatus } from '~/utils/step-status'

export interface RailCtx {
  editable: Ref<boolean>
  /** Tracked by step OBJECT, not id. */
  openSteps: Ref<Set<WorkflowStep>>
  toggleStep: (step: WorkflowStep) => void
  root: Ref<WorkflowStep[]>
  statuses: Ref<Map<string, NodeStatus>>
  submitted: Ref<boolean>
}

export const RAIL_CTX = Symbol('rail-ctx') as InjectionKey<RailCtx>
