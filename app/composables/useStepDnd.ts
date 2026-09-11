import type { InjectionKey, Ref } from 'vue'
import type { WorkflowStep } from '~/utils/dashboard'
import { isCompositeType, MAX_STEP_DEPTH, stepChildren, stepTreeDepth } from '#shared/utils/workflow'

// Drop targets are (list, index) pairs identified by ARRAY REFERENCE: branch
// arrays are stable draft objects, only ever spliced in place.

export type StepDrag
  = | { kind: 'lib', type: WorkflowStep['type'] }
    | { kind: 'step', step: WorkflowStep, from: WorkflowStep[] }

export interface StepDrop {
  list: WorkflowStep[]
  index: number
}

export interface WorkflowDnd {
  drag: Ref<StepDrag | null>
  drop: Ref<StepDrop | null>
  canDropIn: (list: WorkflowStep[], listDepth: number) => boolean
  startLibDrag: (type: WorkflowStep['type']) => void
  startStepDrag: (step: WorkflowStep, from: WorkflowStep[], e: DragEvent) => void
  overRow: (list: WorkflowStep[], listDepth: number, index: number, e: DragEvent) => void
  overList: (list: WorkflowStep[], listDepth: number, e: DragEvent) => void
  overAt: (list: WorkflowStep[], listDepth: number, index: number, e: DragEvent) => void
  performDrop: () => void
  endDrag: () => void
}

export const WORKFLOW_DND = Symbol('workflow-dnd') as InjectionKey<WorkflowDnd>

export function useWorkflowDnd(
  root: Ref<WorkflowStep[]>,
  openSteps: Ref<Set<WorkflowStep>>,
  editable: Ref<boolean>,
): WorkflowDnd {
  const drag = ref<StepDrag | null>(null)
  const drop = ref<StepDrop | null>(null)

  // Dropping a composite into its own body would splice it into an array that
  // just left the tree: silent data loss.
  function insideDragged(list: WorkflowStep[], step: WorkflowStep): boolean {
    for (const branch of stepChildren(step)) {
      if (branch === list) return true
      for (const child of branch) {
        if (insideDragged(list, child)) return true
      }
    }
    return false
  }

  function canDropIn(list: WorkflowStep[], listDepth: number): boolean {
    const d = drag.value
    if (!d || !editable.value) return false
    if (d.kind === 'lib') return listDepth < MAX_STEP_DEPTH || !isCompositeType(d.type)
    return listDepth + stepTreeDepth([d.step]) - 1 <= MAX_STEP_DEPTH && !insideDragged(list, d.step)
  }

  function startLibDrag(type: WorkflowStep['type']) {
    drag.value = { kind: 'lib', type }
  }

  function startStepDrag(step: WorkflowStep, from: WorkflowStep[], e: DragEvent) {
    drag.value = { kind: 'step', step, from }
    openSteps.value.clear()
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', step.id ?? step.type)
    }
  }

  function trackOver(list: WorkflowStep[], listDepth: number, index: number, e: DragEvent) {
    if (!canDropIn(list, listDepth)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = drag.value!.kind === 'lib' ? 'copy' : 'move'
    drop.value = { list, index }
  }

  function overRow(list: WorkflowStep[], listDepth: number, index: number, e: DragEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    trackOver(list, listDepth, e.clientY > rect.top + rect.height / 2 ? index + 1 : index, e)
  }

  function overList(list: WorkflowStep[], listDepth: number, e: DragEvent) {
    const keep = drop.value && drop.value.list === list ? drop.value.index : list.length
    trackOver(list, listDepth, keep, e)
  }

  function performDrop() {
    const d = drag.value
    const target = drop.value
    if (d && target) {
      if (d.kind === 'lib') {
        const step = makeStep(d.type, root.value)
        target.list.splice(target.index, 0, step)
        openSteps.value.add(step)
      }
      else {
        const from = d.from.indexOf(d.step)
        if (from !== -1) {
          d.from.splice(from, 1)
          const index = target.list === d.from && from < target.index ? target.index - 1 : target.index
          target.list.splice(index, 0, d.step)
        }
      }
    }
    endDrag()
  }

  function endDrag() {
    drag.value = null
    drop.value = null
  }

  const dnd: WorkflowDnd = { drag, drop, canDropIn, startLibDrag, startStepDrag, overRow, overList, overAt: trackOver, performDrop, endDrag }
  provide(WORKFLOW_DND, dnd)
  return dnd
}
