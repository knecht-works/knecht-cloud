<script setup lang="ts">
import { WORKFLOW_DND } from '~/composables/useStepDnd'
import { RAIL_CTX } from '~/composables/useWorkflowRail'

const props = defineProps<{
  steps: WorkflowStep[]
  depth: number
  varsBase: VarGroup[]
  loop?: boolean
}>()

const rail = inject(RAIL_CTX)!
const dnd = inject(WORKFLOW_DND)!

const top = computed(() => props.depth === 1)

function groupsFor(i: number): VarGroup[] {
  return [...props.varsBase, ...(props.loop ? [LOOP_VARS] : []), ...stepOutputGroups(props.steps, i)]
}

// v-if narrowing does not reach into sibling template blocks.
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
      <div
        v-if="dropLineAt(i)"
        class="h-1 rounded-full bg-primary"
        :class="top ? 'mb-3 ml-11' : 'my-1'"
        style="box-shadow: 0 0 10px var(--primary)"
      />
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
        <template
          v-if="s.type === 'if'"
          #body
        >
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
                <!-- no `loop`: an enclosing loop's vars already sit in groupsFor(i) -->
                <WorkflowStepList
                  :steps="b.steps"
                  :depth="depth + 1"
                  :vars-base="groupsFor(i)"
                />
              </div>
            </div>
          </div>
        </template>

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

    <div
      v-if="steps.length && dropLineAt(steps.length)"
      class="h-1 rounded-full bg-primary"
      :class="top ? 'mb-3 ml-11' : 'mt-1'"
      style="box-shadow: 0 0 10px var(--primary)"
    />
  </div>
</template>
