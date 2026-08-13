import type { InjectionKey, Ref } from 'vue'
import type { WorkflowStep } from '~/utils/dashboard'
import { isCompositeType, MAX_STEP_DEPTH, stepChildren, stepTreeDepth } from '#shared/utils/workflow'

// Unified drag & drop for the workflow editor: ONE insertion-line model for
// library drops, same-list reorder and cross-list moves, at every nesting
// depth. A drag is either a library step type or an existing step (with the
// sibling array it currently lives in); the drop target is a (list, index)
// pair, the list identified by ARRAY REFERENCE (branch arrays are stable
// draft objects, only ever spliced in place). Lists track dragover with
// stopPropagation so the innermost list wins; the single drop handler sits on
// the rail root and executes whatever `drop` points at.

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
  /** Whether the current drag may land in `list` (depth cap, subtree guard). */
  canDropIn: (list: WorkflowStep[], listDepth: number) => boolean
  startLibDrag: (type: WorkflowStep['type']) => void
  startStepDrag: (step: WorkflowStep, from: WorkflowStep[], e: DragEvent) => void
  /** dragover on a row: insertion point before/after by cursor half. */
  overRow: (list: WorkflowStep[], listDepth: number, index: number, e: DragEvent) => void
  /** dragover on a list's container: keeps a row-refined point, else appends. */
  overList: (list: WorkflowStep[], listDepth: number, e: DragEvent) => void
  /** dragover with a fixed insertion point (append zones, empty lists). */
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

  // Dropping a composite into its own body would splice it out of the tree
  // and into an array that just left it: silent data loss. Walk the dragged
  // subtree's child arrays and compare identity.
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
    // A move carries the step's whole subtree; the cap counts from the target
    // list's depth. The schema re-checks server-side on save.
    return listDepth + stepTreeDepth([d.step]) - 1 <= MAX_STEP_DEPTH && !insideDragged(list, d.step)
  }

  function startLibDrag(type: WorkflowStep['type']) {
    drag.value = { kind: 'lib', type }
  }

  function startStepDrag(step: WorkflowStep, from: WorkflowStep[], e: DragEvent) {
    drag.value = { kind: 'step', step, from }
    // Collapse open settings for the drag: expanded cards are tall and make
    // insertion points jump under the cursor.
    openSteps.value.clear()
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', step.id ?? step.type)
    }
  }

  function trackOver(list: WorkflowStep[], listDepth: number, index: number, e: DragEvent) {
    if (!canDropIn(list, listDepth)) return
    // preventDefault marks the target droppable; stopPropagation keeps outer
    // lists from overriding the innermost one's insertion point.
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
