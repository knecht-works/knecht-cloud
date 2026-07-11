<script setup lang="ts">
import { isCompositeType, MAX_STEP_DEPTH } from '#shared/utils/workflow'
import { STEP_DND } from '~/composables/useStepDnd'

// A composite step's nested step list (if branches, loop body), edited inline
// inside the parent's settings card. Deliberately simpler than the top-level
// rail: reorder via up/down, add via a type menu (or a library drop).
const props = defineProps<{
  /** The branch array, mutated in place (the draft owns the state). */
  steps: WorkflowStep[]
  /** The workflow's ROOT step list; ids are unique across the whole tree. */
  root: WorkflowStep[]
  /** Variable groups visible at the composite step itself. */
  varsBase: VarGroup[]
  /** True when these steps run inside a loop ({{ loop.item }} available). */
  loop?: boolean
  /** Nesting depth of THESE steps (top-level = 1); caps further composites. */
  depth: number
  editable: boolean
  title: string
}>()

const open = ref(new Set<WorkflowStep>())

// The branch is edited in place: the draft object owns the state, the same
// contract as StepSettings' `record`.
const list = computed(() => props.steps)

// One presentation object per row, computed once per invalidation instead of
// per template read (the deep-reactive draft re-renders on every keystroke).
const rows = computed(() => list.value.map(step => ({
  step,
  meta: workflowStepMeta(step),
  valid: stepValid(step),
})))

function toggle(step: WorkflowStep) {
  if (open.value.has(step)) open.value.delete(step)
  else open.value.add(step)
}

// Composites are offered only while their children would stay within the
// depth cap; the schema enforces the same limit server-side.
const addItems = computed(() => STEP_DEFS
  .filter(d => props.depth < MAX_STEP_DEPTH || !isCompositeType(d.type))
  .map(d => ({
    label: d.label,
    icon: d.icon,
    onSelect: () => {
      const step = makeStep(d.type, props.root)
      list.value.push(step)
      open.value.add(step)
    },
  })))

function move(i: number, delta: -1 | 1) {
  const to = i + delta
  if (to < 0 || to >= list.value.length) return
  const [step] = list.value.splice(i, 1)
  list.value.splice(to, 0, step!)
}

function remove(i: number) {
  const [removed] = list.value.splice(i, 1)
  if (removed) open.value.delete(removed)
}

// What sub-step `i` can reference: everything the composite sees, the loop
// vars when applicable, and the outputs of its prior siblings.
function groupsFor(i: number): VarGroup[] {
  return [...props.varsBase, ...(props.loop ? [LOOP_VARS] : []), ...stepOutputGroups(props.steps, i)]
}

// ── library drops ────────────────────────────────────────────────────────────
// The page provides the library-drag state (useStepDnd); this list is a drop
// target too: rows track an insertion index (upper/lower half → before/after),
// dragover suppresses the rail's own insertion line, drops respect the depth
// cap. Row reordering stays up/down only.
const dnd = inject(STEP_DND, null)
const dropAt = ref<number | null>(null)

const droppable = computed(() => {
  const type = dnd?.libDrag.value
  if (!type || !props.editable) return false
  return props.depth < MAX_STEP_DEPTH || !isCompositeType(type)
})

function trackDrop(e: DragEvent, index: number | null) {
  if (!droppable.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dnd!.dropIndex.value = null
  dropAt.value = index ?? dropAt.value ?? list.value.length
}

function onRowOver(i: number, e: DragEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  trackDrop(e, e.clientY > rect.top + rect.height / 2 ? i + 1 : i)
}

function onZoneLeave(e: DragEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dropAt.value = null
}

function onZoneDrop(e: DragEvent) {
  if (!droppable.value) return
  e.preventDefault()
  e.stopPropagation()
  const step = makeStep(dnd!.libDrag.value!, props.root)
  list.value.splice(dropAt.value ?? list.value.length, 0, step)
  open.value.add(step)
  dropAt.value = null
  dnd!.endDrag()
}
</script>

<template>
  <div
    @dragover="trackDrop($event, null)"
    @dragleave="onZoneLeave"
    @drop="onZoneDrop"
  >
    <div class="flex items-center justify-between">
      <span class="k-label">{{ title }}</span>
      <UDropdownMenu :items="addItems">
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-plus"
          label="Add step"
          :disabled="!editable"
        />
      </UDropdownMenu>
    </div>
    <p
      v-if="!steps.length"
      class="mt-1.5 rounded-md border border-dashed px-3 py-2.5 text-xs text-dimmed"
      :style="{ borderColor: droppable ? 'var(--primary)' : 'var(--border-muted)' }"
    >
      {{ droppable ? 'Drop step here.' : 'No steps yet.' }}
    </p>
    <div
      v-else
      class="mt-1.5 flex flex-col gap-1.5"
    >
      <template
        v-for="({ step: s, meta, valid }, i) in rows"
        :key="s.id ?? i"
      >
        <!-- library-drop insertion line -->
        <div
          v-if="droppable && dropAt === i"
          class="h-1 rounded-full bg-primary"
          style="box-shadow: 0 0 10px var(--primary)"
        />
        <div
          class="rounded-md border bg-(--surface-muted)"
          :style="{ borderColor: valid ? 'var(--border-default)' : 'var(--accent-orange)' }"
          @dragover="onRowOver(i, $event)"
        >
          <div class="group/row flex items-center gap-2.5 px-2.5 py-2">
            <KStepIcon
              :icon="meta.icon"
              :color="STEP_KIND_COLOR[meta.kind]"
              :size="26"
              :radius="6"
            />
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              @click="toggle(s)"
            >
              <span class="block truncate text-xs font-medium text-highlighted">{{ meta.label }}</span>
              <span
                v-if="meta.detail"
                class="k-mono block truncate text-3xs text-dimmed"
              >{{ meta.detail }}</span>
            </button>
            <span class="k-mono text-3xs text-dimmed">{{ s.id }}</span>
            <div class="flex flex-none items-center">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-chevron-up"
                aria-label="Move up"
                :disabled="!editable || i === 0"
                @click="move(i, -1)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-chevron-down"
                aria-label="Move down"
                :disabled="!editable || i === rows.length - 1"
                @click="move(i, 1)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash-2"
                aria-label="Remove step"
                :disabled="!editable"
                class="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
                @click="remove(i)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="open.has(s) ? 'i-lucide-chevron-down' : 'i-lucide-settings-2'"
                :aria-label="open.has(s) ? 'Collapse' : 'Settings'"
                @click="toggle(s)"
              />
            </div>
          </div>
          <WorkflowStepSettings
            v-if="open.has(s)"
            :step="s"
            :groups="groupsFor(i)"
            :editable="editable"
            :root="root"
            :depth="depth"
          />
        </div>
      </template>
      <!-- append drop line (below the last row) -->
      <div
        v-if="droppable && dropAt === rows.length"
        class="h-1 rounded-full bg-primary"
        style="box-shadow: 0 0 10px var(--primary)"
      />
    </div>
  </div>
</template>
