import type { Ref } from 'vue'
import type { WorkflowStep } from '~/utils/dashboard'

// Drag & drop for the workflow editor's step rail. Rows: the grip handle arms
// its row (HTML5 `draggable` needs to sit on the row, but dragging should only
// start from the grip); rows reorder live while dragging over each other.
// Library items: the library reports the dragged step type; hovering the rail
// tracks an insertion point (upper/lower row half → before/after), rendered as
// a drop line; dropping inserts there.
export function useStepDnd(
  steps: Ref<WorkflowStep[]>,
  openSteps: Ref<Set<WorkflowStep>>,
) {
  const dragIndex = ref<number | null>(null)
  const dragArmed = ref<number | null>(null)
  const libDrag = ref<WorkflowStep['type'] | null>(null)
  const dropIndex = ref<number | null>(null)

  // Move a step from → to (the open state tracks step objects, so it follows).
  function reorder(from: number, to: number) {
    const s = steps.value
    if (to < 0 || to >= s.length || from === to) return
    const [item] = s.splice(from, 1)
    s.splice(to, 0, item!)
  }

  function onDragStart(i: number, e: DragEvent) {
    dragIndex.value = i
    // Collapse open settings for the drag: expanded cards are tall, and live
    // reordering around a tall card makes the rows jump under the cursor.
    openSteps.value.clear()
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(i))
    }
  }

  function onDragOver(i: number, e: DragEvent) {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const pastMidpoint = e.clientY > rect.top + rect.height / 2
    if (dragIndex.value !== null) {
      if (dragIndex.value === i) return
      // Swap only once the cursor crosses the hovered card's midpoint,
      // otherwise unequal card heights make the rows oscillate.
      if (dragIndex.value < i ? pastMidpoint : !pastMidpoint) {
        reorder(dragIndex.value, i)
        dragIndex.value = i
      }
    }
    else if (libDrag.value) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      dropIndex.value = pastMidpoint ? i + 1 : i
    }
  }

  // The rail column accepts library drops anywhere (rows refine the position).
  function onRailOver(e: DragEvent) {
    if (!libDrag.value) return
    e.preventDefault()
    if (dropIndex.value === null) dropIndex.value = steps.value.length
  }

  function onRailDrop() {
    if (libDrag.value && dropIndex.value !== null) {
      steps.value.splice(dropIndex.value, 0, makeStep(libDrag.value, steps.value))
      openSteps.value.add(steps.value[dropIndex.value]!)
    }
    endDrag()
  }

  function endDrag() {
    dragIndex.value = null
    dragArmed.value = null
    libDrag.value = null
    dropIndex.value = null
  }

  return { dragIndex, dragArmed, libDrag, dropIndex, onDragStart, onDragOver, onRailOver, onRailDrop, endDrag }
}
