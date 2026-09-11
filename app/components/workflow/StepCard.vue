<script setup lang="ts">
import { WORKFLOW_DND } from '~/composables/useStepDnd'
import { RAIL_CTX } from '~/composables/useWorkflowRail'

const props = defineProps<{
  step: WorkflowStep
  list: WorkflowStep[]
  index: number
  depth: number
  groups: VarGroup[]
  last?: boolean
}>()

const rail = inject(RAIL_CTX)!
const dnd = inject(WORKFLOW_DND)!

const top = computed(() => props.depth === 1)
const meta = computed(() => workflowStepMeta(props.step))
const editable = computed(() => rail.editable.value)
const open = computed(() => rail.openSteps.value.has(props.step))

const node = computed<NodeStatus>(() =>
  rail.statuses.value.get(props.step.id ?? '') ?? { status: open.value ? 'selected' : 'idle' })
const status = computed(() => node.value.status)

const issues = computed(() =>
  stepIssues(props.step).filter(issue => rail.submitted.value || !stepPristine(issue.step)))

const dragged = computed(() => dnd.drag.value?.kind === 'step' && dnd.drag.value.step === props.step)
const armed = ref(false)

const list = computed(() => props.list)

const borderColor = computed(() => {
  if (editable.value && issues.value.length) return 'var(--accent-orange)'
  if (open.value) return 'var(--border-accented)'
  return TREAT[status.value].border
})

function remove() {
  const [removed] = list.value.splice(props.index, 1)
  if (removed) rail.openSteps.value.delete(removed)
}
</script>

<template>
  <div
    class="flex gap-3.5"
    :style="{ opacity: dragged ? 0.45 : TREAT[status].dim ? 0.55 : 1 }"
    :draggable="armed"
    @dragstart.stop="dnd.startStepDrag(step, list, $event)"
    @dragover="dnd.overRow(list, depth, index, $event)"
    @dragend="dnd.endDrag"
  >
    <div
      v-if="top"
      class="flex w-7.5 flex-none flex-col items-center"
    >
      <span
        v-if="status === 'done'"
        class="k-mono grid size-7.5 flex-none place-items-center rounded-full"
        style="background: var(--lime-950); border: 1px solid var(--primary-border); color: var(--primary)"
      >
        <UIcon
          name="i-lucide-check"
          class="size-4"
        />
      </span>
      <span
        v-else-if="status === 'running'"
        class="grid size-7.5 flex-none place-items-center rounded-full"
        style="background: color-mix(in oklab, var(--accent-orange) 20%, var(--surface-muted)); border: 1px solid var(--accent-orange)"
      >
        <KStatusDot
          color="orange"
          pulse
          :size="8"
        />
      </span>
      <span
        v-else-if="status === 'error'"
        class="k-mono grid size-7.5 flex-none place-items-center rounded-full text-2sm font-semibold"
        style="background: color-mix(in oklab, var(--status-error) 18%, var(--surface-muted)); border: 1px solid var(--status-error); color: var(--status-error)"
      >!</span>
      <span
        v-else-if="status === 'skipped'"
        class="k-mono grid size-7.5 flex-none place-items-center rounded-full border border-muted bg-(--surface-muted) text-dimmed"
      >–</span>
      <span
        v-else
        class="k-mono grid size-7.5 flex-none place-items-center rounded-full text-xs font-semibold"
        :style="editable && issues.length
          ? { background: 'color-mix(in oklab, var(--accent-orange) 12%, var(--surface-muted))', border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)' }
          : status === 'selected'
            ? { background: 'var(--surface-accented)', border: '1px solid var(--border-accented)', color: 'var(--text-toned)' }
            : { background: 'var(--surface-muted)', border: '1px solid var(--border-accented)', color: 'var(--text-muted)' }"
      >{{ index + 1 }}</span>
      <span
        v-if="!last"
        class="my-1 w-0.5 flex-1 rounded-sm bg-(--border-default)"
        style="min-height: 16px"
      />
    </div>

    <div
      :id="`step-card-${step.id}`"
      class="relative min-w-0 flex-1 overflow-hidden"
      :class="top ? 'mb-3 rounded-lg' : 'rounded-md'"
      :style="{
        border: `1px solid ${borderColor}`,
        background: TREAT[status].bg,
        boxShadow: 'var(--shadow-panel)',
      }"
    >
      <span
        v-if="TREAT[status].accent"
        class="absolute inset-y-0 left-0 z-10 w-1"
        :style="{ background: TREAT[status].accent! }"
      />
      <div
        class="group/row flex items-center"
        :class="top ? 'gap-2.5 py-2.5 pl-2.5 pr-3' : 'gap-2 py-2 pl-2 pr-2.5'"
      >
        <span
          v-if="editable"
          class="flex-none cursor-grab text-dimmed transition-colors hover:text-muted active:cursor-grabbing"
          aria-label="Drag to reorder"
          @mousedown="armed = true"
          @mouseup="armed = false"
        >
          <UIcon
            name="i-lucide-grip-vertical"
            class="size-4"
          />
        </span>
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center text-left"
          :class="top ? 'gap-3' : 'gap-2.5'"
          :aria-label="open ? 'Collapse settings' : 'Open settings'"
          @click="rail.toggleStep(step)"
        >
          <KStepIcon
            :icon="meta.icon"
            :color="STEP_KIND_COLOR[meta.kind]"
            :size="top ? 34 : 26"
            :radius="top ? 8 : 6"
          />
          <span class="min-w-0 flex-1">
            <span
              class="block truncate font-medium text-highlighted"
              :class="top ? 'text-sm' : 'text-xs'"
            >{{ meta.label }}</span>
            <span
              class="block truncate"
              :class="top ? 'mt-1 text-xs' : 'text-3xs'"
              :style="{ color: status === 'error' ? 'var(--status-error)' : editable && issues.length ? 'var(--accent-orange)' : 'var(--text-muted)' }"
            >
              {{ editable && issues.length ? issueSummary({ step, issues }) : (meta.detail || 'Not configured yet') }}
            </span>
          </span>
        </button>
        <span
          v-if="node.runs != null && node.runs > 1"
          class="k-mono flex-none rounded-full border border-muted px-1.5 text-3xs leading-4 text-dimmed"
        >×{{ node.runs }}</span>
        <span
          v-if="STATUS_LABEL[status]"
          class="k-mono flex-none text-3xs uppercase tracking-widest"
          :style="{ color: STATUS_LABEL[status]!.color }"
        >{{ STATUS_LABEL[status]!.text }}</span>
        <UButton
          v-if="editable"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-trash-2"
          aria-label="Remove step"
          class="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
          @click="remove"
        />
        <UIcon
          name="i-lucide-chevron-down"
          class="size-4 flex-none cursor-pointer text-dimmed transition-transform duration-300"
          :class="{ 'rotate-180': open }"
          @click="rail.toggleStep(step)"
        />
      </div>

      <div
        class="grid transition-[grid-template-rows] duration-300 ease-out"
        :style="{ gridTemplateRows: open ? '1fr' : '0fr' }"
      >
        <div class="overflow-hidden">
          <WorkflowStepSettings
            v-if="open"
            :step="step"
            :groups="groups"
            :editable="editable"
            :root="rail.root.value"
          />
        </div>
      </div>

      <slot name="body" />
    </div>
  </div>
</template>
