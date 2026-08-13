<script setup lang="ts">
import { WORKFLOW_DND } from '~/composables/useStepDnd'
import { RAIL_CTX } from '~/composables/useWorkflowRail'

// One step list rendered as a vertical flow: the root sequence, an if branch
// or a loop body. Composites recurse: an if card fans out into two branch
// columns (side by side when the container is wide enough, stacked otherwise)
// that merge back into the next step; a loop card gets a framed body. All
// connectors are plain CSS borders: no measurement, reflow for free.
const props = defineProps<{
  /** The list array, mutated in place (the draft owns the state). */
  steps: WorkflowStep[]
  /** Nesting depth of the steps IN this list (top-level = 1). */
  depth: number
  /** Variable groups visible at this list's entry point. */
  varsBase: VarGroup[]
  /** True when these steps run inside a loop ({{ loop.* }} available). */
  loop?: boolean
}>()

const rail = inject(RAIL_CTX)!
const dnd = inject(WORKFLOW_DND)!

const top = computed(() => props.depth === 1)

// What sub-step `i` can reference: everything the list's scope sees, the loop
// vars when applicable, and the outputs of its prior siblings.
function groupsFor(i: number): VarGroup[] {
  return [...props.varsBase, ...(props.loop ? [LOOP_VARS] : []), ...stepOutputGroups(props.steps, i)]
}

// Template helpers narrowing the step union (v-if narrowing does not reach
// into sibling template blocks).
function ifBranches(step: WorkflowStep) {
  const s = step as Extract<WorkflowStep, { type: 'if' }>
  return [
    { key: 'then', label: 'Then', steps: s.then },
    { key: 'else', label: 'Else', steps: s.else },
  ]
}
function loopOf(step: WorkflowStep) {
  return step as Extract<WorkflowStep, { type: 'loop' }>
}

const dropTarget = computed(() => dnd.drop.value)
const droppable = computed(() => dnd.canDropIn(props.steps, props.depth))
function dropLineAt(index: number): boolean {
  return !!dropTarget.value && dropTarget.value.list === props.steps && dropTarget.value.index === index
}

// A branch whose steps ALL resolved to skipped was not taken: the whole limb
// dims so the taken path stands out during/after a run.
function branchSkipped(branch: WorkflowStep[]): boolean {
  return branch.length > 0
    && branch.every(c => rail.statuses.value.get(c.id ?? '')?.status === 'skipped')
}
</script>

<template>
  <div
    class="flex flex-col"
    @dragover="dnd.overList(steps, depth, $event)"
  >
    <!-- empty list (nested): dashed placeholder, doubles as the drop target -->
    <p
      v-if="!steps.length && !top"
      class="rounded-md border border-dashed px-3 py-2.5 text-center text-xs text-dimmed"
      :style="{ borderColor: droppable ? 'var(--primary)' : 'var(--border-muted)' }"
    >
      {{ droppable ? 'Drop step here.' : 'No steps yet.' }}
    </p>

    <template
      v-for="(s, i) in steps"
      :key="i"
    >
      <!-- insertion line (library drops and step moves) -->
      <div
        v-if="dropLineAt(i)"
        class="h-1 rounded-full bg-primary"
        :class="top ? 'mb-3 ml-11' : 'my-1'"
        style="box-shadow: 0 0 10px var(--primary)"
      />
      <!-- connector stub between nested siblings -->
      <div
        v-else-if="!top && i > 0"
        class="mx-auto h-4 w-px bg-(--border-default)"
      />

      <WorkflowStepCard
        :step="s"
        :list="steps"
        :index="i"
        :depth="depth"
        :groups="groupsFor(i)"
        :last="i === steps.length - 1"
      >
        <!-- if: the branch columns, inside the card's own border -->
        <template
          v-if="s.type === 'if'"
          #body
        >
          <!-- the body is a recessed well (inset surface + inner shadow):
               nested cards float on it, which is what carries the depth -->
          <div
            class="border-t border-muted bg-(--surface-inset) px-3 pb-3 pt-2.5 @container"
            style="box-shadow: inset 0 2px 6px -3px oklch(0 0 0 / 0.5)"
          >
            <div class="grid grid-cols-1 gap-y-4 @[36rem]:grid-cols-2 @[36rem]:gap-x-4">
              <div
                v-for="b in ifBranches(s)"
                :key="b.key"
                class="flex min-w-0 flex-col transition-opacity"
                :class="{ 'opacity-55': branchSkipped(b.steps) }"
                @dragover="dnd.overAt(b.steps, depth + 1, b.steps.length, $event)"
              >
                <span class="k-label mx-auto mb-2">{{ b.label }}</span>
                <!-- no `loop` here: an enclosing loop's vars already sit in
                     groupsFor(i), the branch list must not add them twice -->
                <WorkflowStepList
                  :steps="b.steps"
                  :depth="depth + 1"
                  :vars-base="groupsFor(i)"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- loop: the body steps, inside the card's own border -->
        <template
          v-else-if="s.type === 'loop'"
          #body
        >
          <div
            class="border-t border-muted bg-(--surface-inset) px-3 pb-3 pt-2.5"
            style="box-shadow: inset 0 2px 6px -3px oklch(0 0 0 / 0.5)"
            @dragover="dnd.overAt(loopOf(s).steps, depth + 1, loopOf(s).steps.length, $event)"
          >
            <div class="mb-2.5 flex items-center gap-2">
              <UIcon
                name="i-lucide-repeat"
                class="size-3.5 flex-none text-dimmed"
              />
              <span class="k-label flex-none">Each item</span>
              <span class="k-mono min-w-0 truncate text-2xs text-dimmed">{{ loopOf(s).items }}</span>
            </div>
            <WorkflowStepList
              :steps="loopOf(s).steps"
              :depth="depth + 1"
              :vars-base="groupsFor(i)"
              loop
            />
          </div>
        </template>
      </WorkflowStepCard>
    </template>

    <!-- append insertion line (below the last row) -->
    <div
      v-if="steps.length && dropLineAt(steps.length)"
      class="h-1 rounded-full bg-primary"
      :class="top ? 'mb-3 ml-11' : 'mt-1'"
      style="box-shadow: 0 0 10px var(--primary)"
    />
  </div>
</template>
