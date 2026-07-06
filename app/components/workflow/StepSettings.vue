<script setup lang="ts">
import { isComposite } from '#shared/utils/workflow'

// The expanded step's settings, rendered inline inside its card: display
// name/note, the registry-driven fields, and the n8n-style variable list —
// everything available at THIS point of the sequence, click-to-insert into the
// last-focused field (or type `{{` for autocomplete).
const props = defineProps<{
  step: WorkflowStep
  groups: VarGroup[]
  editable: boolean
  /** The workflow's ROOT step list — composite steps create sub-steps with tree-unique ids. */
  root: WorkflowStep[]
  /** The step's nesting depth (top-level = 1); composites cap at MAX_STEP_DEPTH. */
  depth: number
}>()

const def = computed(() => stepDef(props.step.type))
const meta = computed(() => workflowStepMeta(props.step))

// Step params are edited in place (the draft object owns the state).
const record = computed(() => props.step as unknown as Record<string, string | boolean>)

// Chip inserts go to the last-focused template-capable field (falls back to
// the first one). Typed against VarField's exposed API.
interface VarFieldApi {
  insertVar: (path: string) => void
  acceptsVars: () => boolean
}
const fieldRefs = ref<(VarFieldApi | null)[]>([])
const focused = ref<number | null>(null)

function insert(path: string) {
  const target = (focused.value !== null && fieldRefs.value[focused.value]?.acceptsVars())
    ? fieldRefs.value[focused.value]
    : fieldRefs.value.find(f => f?.acceptsVars())
  target?.insertVar(path)
}

const hasVarFields = computed(() => def.value.fields.some(f => f.vars))

// The variable reference list is collapsed by default — on big workflows it
// grows a row per prior step and would dwarf the actual settings. The header
// stays visible (with a count and the `{{` hint), so insertion is one click
// away and typing `{{` needs no expansion at all.
const varsOpen = ref(false)
const varCount = computed(() => props.groups.reduce((n, g) => n + g.vars.length, 0))
</script>

<template>
  <div class="flex flex-col gap-4 border-t border-(--border-muted) px-[15px] py-4">
    <!-- display name + note (fall back to the derived label/detail) -->
    <div class="flex flex-col gap-2">
      <input
        :value="step.label ?? ''"
        :placeholder="def.label"
        spellcheck="false"
        :disabled="!editable"
        aria-label="Step name"
        class="w-full bg-transparent text-sm font-medium text-(--text-highlighted) outline-none placeholder:text-(--text-dimmed)"
        @input="record.label = ($event.target as HTMLInputElement).value"
      >
      <input
        :value="step.description ?? ''"
        placeholder="Add a note (optional)"
        spellcheck="false"
        :disabled="!editable"
        aria-label="Step note"
        class="w-full bg-transparent text-xs text-(--text-muted) outline-none placeholder:text-(--text-dimmed)"
        @input="record.description = ($event.target as HTMLInputElement).value"
      >
    </div>

    <!-- settings fields, from the registry -->
    <template v-if="def.fields.length">
      <WorkflowVarField
        v-for="(f, i) in def.fields"
        :key="f.key"
        :ref="(el: unknown) => { fieldRefs[i] = el as VarFieldApi | null }"
        v-model="record[f.key]"
        :field="f"
        :groups="groups"
        :disabled="!editable"
        @focus="focused = i"
      />
    </template>
    <p
      v-else-if="!isComposite(step)"
      class="text-[12.5px] text-(--text-muted)"
    >
      {{ meta.detail }} — this step has no settings.
    </p>

    <!-- composite steps: conditions + nested step lists -->
    <template v-if="step.type === 'if'">
      <WorkflowConditionEditor
        :step="step"
        :editable="editable"
      />
      <WorkflowSubSteps
        :steps="step.then"
        title="Then"
        :root="root"
        :vars-base="groups"
        :depth="depth + 1"
        :editable="editable"
      />
      <WorkflowSubSteps
        :steps="step.else"
        title="Else"
        :root="root"
        :vars-base="groups"
        :depth="depth + 1"
        :editable="editable"
      />
    </template>
    <WorkflowSubSteps
      v-if="step.type === 'loop'"
      :steps="step.steps"
      title="Loop steps"
      loop
      :root="root"
      :vars-base="groups"
      :depth="depth + 1"
      :editable="editable"
    />

    <!-- available variables (n8n-style): context + prior steps' outputs -->
    <div
      v-if="hasVarFields"
      class="border-t border-(--border-muted) pt-3.5"
    >
      <button
        type="button"
        :aria-expanded="varsOpen"
        class="group flex w-full cursor-pointer items-center gap-2"
        @click="varsOpen = !varsOpen"
      >
        <UIcon
          name="i-lucide-braces"
          class="size-3.5 flex-none text-(--text-dimmed)"
        />
        <span class="k-label transition-colors group-hover:text-(--text-muted)">Variables</span>
        <span class="k-mono flex-none rounded-full border border-(--border-muted) px-1.5 text-[10px] leading-[16px] text-(--text-dimmed)">{{ varCount }}</span>
        <span class="min-w-0 flex-1" />
        <span class="truncate text-[11px] text-(--text-dimmed)">click to insert, or type <span class="k-mono text-(--text-muted)">{{ '\{\{' }}</span> in a field</span>
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3.5 flex-none text-(--text-dimmed) transition-transform duration-300"
          :class="{ 'rotate-180': varsOpen }"
        />
      </button>
      <!-- Aligned two-column list: a fixed label column (truncated — the
           leading step number stays visible, the full name is the title) and
           the chip column, so rows scan cleanly however long a step name is. -->
      <div
        class="grid transition-[grid-template-rows] duration-300 ease-out"
        :style="{ gridTemplateRows: varsOpen ? '1fr' : '0fr' }"
      >
        <div class="overflow-hidden">
          <div class="grid grid-cols-[minmax(90px,130px)_1fr] items-baseline gap-x-3 gap-y-2 pt-3">
            <template
              v-for="g in groups"
              :key="g.label"
            >
              <span
                class="flex min-w-0 items-center gap-1.5 pt-1"
                :title="g.label"
              >
                <span
                  class="size-1.5 flex-none rounded-full"
                  :style="{ background: g.color }"
                />
                <span class="truncate text-[11px] text-(--text-dimmed)">{{ g.label }}</span>
              </span>
              <div class="flex flex-wrap gap-1.5">
                <UTooltip
                  v-for="v in g.vars"
                  :key="v.path"
                  :text="v.hint"
                >
                  <button
                    type="button"
                    :disabled="!editable"
                    :style="{ '--chip-accent': g.color }"
                    class="k-mono rounded-(--radius-sm) border border-[color-mix(in_oklab,var(--chip-accent)_22%,var(--border-default))] bg-(--surface-base) px-2 py-1 text-[11px] transition-colors hover:border-[color-mix(in_oklab,var(--chip-accent)_60%,var(--border-default))] disabled:cursor-not-allowed disabled:opacity-50"
                    @click="insert(v.path)"
                  >
                    <span class="text-(--text-dimmed)">{{ varPathParts(v.path)[0] }}</span><span class="text-(--chip-accent)">{{ varPathParts(v.path)[1] }}</span>
                  </button>
                </UTooltip>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
