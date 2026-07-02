<script setup lang="ts">
// The expanded step's settings, rendered inline inside its card: display
// name/note, the registry-driven fields, and the n8n-style variable list —
// everything available at THIS point of the sequence, click-to-insert into the
// last-focused field (or type `{{` for autocomplete).
const props = defineProps<{
  step: WorkflowStep
  groups: VarGroup[]
  editable: boolean
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
      v-else
      class="text-[12.5px] text-(--text-muted)"
    >
      {{ meta.detail }} — this step has no settings.
    </p>

    <!-- available variables (n8n-style): context + prior steps' outputs -->
    <div
      v-if="hasVarFields"
      class="border-t border-(--border-muted) pt-3.5"
    >
      <div class="mb-2.5 flex items-baseline gap-2">
        <span class="flex items-center gap-1.5">
          <UIcon
            name="i-lucide-braces"
            class="size-3.5 text-(--text-dimmed)"
          />
          <span class="k-label">Variables</span>
        </span>
        <span class="text-[11px] text-(--text-dimmed)">click to insert, or type <span class="k-mono text-(--text-muted)">{{ '\{\{' }}</span> in a field</span>
      </div>
      <div class="flex flex-col gap-2.5">
        <div
          v-for="g in groups"
          :key="g.label"
          class="flex flex-wrap items-center gap-1.5"
        >
          <span class="k-mono min-w-[72px] text-[10px] uppercase tracking-[0.08em] text-(--text-dimmed)">{{ g.label }}</span>
          <UTooltip
            v-for="v in g.vars"
            :key="v.path"
            :text="v.hint"
          >
            <button
              type="button"
              :disabled="!editable"
              class="k-mono rounded-(--radius-sm) border border-(--border-default) bg-(--surface-base) px-2 py-1 text-[11px] text-(--text-muted) transition-colors hover:border-(--border-accented) hover:text-(--text-toned) disabled:cursor-not-allowed disabled:opacity-50"
              @click="insert(v.path)"
            >
              {{ v.path }}
            </button>
          </UTooltip>
        </div>
      </div>
    </div>
  </div>
</template>
