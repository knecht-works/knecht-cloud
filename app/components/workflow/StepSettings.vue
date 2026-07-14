<script setup lang="ts">
import { defaultStepTimeout, deriveStepId, isComposite, isDerivedStepId, renameStepReferences, STEP_ID_RE, stepIds } from '#shared/utils/workflow'

// The expanded step's settings, rendered inline inside its card: display
// name/note, the registry-driven fields, and the n8n-style variable list,
// everything available at THIS point of the sequence, click-to-insert into the
// last-focused field (or type `{{` for autocomplete).
const props = defineProps<{
  step: WorkflowStep
  groups: VarGroup[]
  editable: boolean
  /** The workflow's ROOT step list; composite steps create sub-steps with tree-unique ids. */
  root: WorkflowStep[]
  /** The step's nesting depth (top-level = 1); composites cap at MAX_STEP_DEPTH. */
  depth: number
}>()

const def = computed(() => stepDef(props.step.type))
const meta = computed(() => workflowStepMeta(props.step))

// Step params are edited in place (the draft object owns the state).
const record = computed(() => props.step as unknown as Record<string, string | boolean>)

// The step's error policy (StepMeta), edited in place like the params.
const policy = computed(() => props.step as { continueOnError?: boolean, timeoutSeconds?: number })

// An empty required field blocks the save (stepIssues); the field itself
// wears the highlight so the problem is visible right where it's fixed. A
// pristine (just-added, untouched) step stays quiet: the required stars say
// enough until the user starts filling it in, or until a failed save flips
// the page's FORCE_STEP_ISSUES.
const forced = inject(FORCE_STEP_ISSUES, () => ref(false), true)
const pristine = computed(() => stepPristine(props.step))
function fieldInvalid(f: StepField): boolean {
  if (pristine.value && !forced.value) return false
  return !!f.required && !String((props.step as unknown as Record<string, unknown>)[f.key] ?? '').trim()
}

// Empty (or invalid) input falls back to the runner's default: the key is
// removed so the stored step doesn't pin the current default value.
function onTimeoutInput(value: string) {
  const seconds = Number.parseInt(value, 10)
  if (Number.isFinite(seconds) && seconds > 0) policy.value.timeoutSeconds = seconds
  else delete policy.value.timeoutSeconds
}

// ── step id: derived from the label, hand-editable, references follow ────────
// While the id still looks auto-derived (run_command, run_command_2, or the
// backfill's type slug link_check) a label edit re-derives it; a hand-edited
// id sticks. Every rename rewrites the tree's {{ steps.<id>… }} references,
// so templates never break.
const idDraft = ref(props.step.id ?? '')
watch(() => props.step.id, id => idDraft.value = id ?? '')

// The tree's ids minus this step's own: what a rename must stay unique against.
function takenIds(): Set<string> {
  const taken = stepIds(props.root)
  if (props.step.id) taken.delete(props.step.id)
  return taken
}

const idError = computed(() => {
  const id = idDraft.value.trim()
  if (id === props.step.id) return ''
  if (!STEP_ID_RE.test(id)) return 'Lowercase letters, digits and underscores, starting with a letter'
  if (takenIds().has(id)) return 'Already used by another step'
  return ''
})

function renameId(newId: string) {
  const oldId = props.step.id
  if (!oldId || newId === oldId) return
  renameStepReferences(props.root, oldId, newId)
  record.value.id = newId
}

function onIdInput(value: string) {
  idDraft.value = value
  const id = value.trim()
  if (STEP_ID_RE.test(id) && !takenIds().has(id)) renameId(id)
}

function onLabelInput(value: string) {
  const prev = props.step.label?.trim() || def.value.label
  const auto = !!props.step.id
    && (isDerivedStepId(props.step.id, prev) || isDerivedStepId(props.step.id, props.step.type))
  record.value.label = value
  if (auto) renameId(deriveStepId(value.trim() || def.value.label, takenIds()))
}

// Chip inserts go to the last-focused template-capable field (falls back to
// the first one). Typed against VarField's exposed API.
interface VarFieldApi {
  insertVar: (path: string) => void
  acceptsVars: () => boolean
}
const fieldRefs = ref<(VarFieldApi | null)[]>([])
const focused = ref<number | null>(null)
// The if step has no registry fields; its condition editor routes inserts to
// the last-focused condition side itself.
const conditionEditor = ref<{ insertVar: (path: string) => void } | null>(null)

function insert(path: string) {
  const target = (focused.value !== null && fieldRefs.value[focused.value]?.acceptsVars())
    ? fieldRefs.value[focused.value]
    : fieldRefs.value.find(f => f?.acceptsVars())
  if (target) target.insertVar(path)
  else conditionEditor.value?.insertVar(path)
}

const hasVarFields = computed(() => def.value.fields.some(f => f.vars) || props.step.type === 'if')

// The variable reference list is collapsed by default. On big workflows it
// grows a row per prior step and would dwarf the actual settings. The header
// stays visible (with a count and the `{{` hint), so insertion is one click
// away and typing `{{` needs no expansion at all.
const varsOpen = ref(false)
const varCount = computed(() => props.groups.reduce((n, g) => n + g.vars.length, 0))
</script>

<template>
  <div class="flex flex-col gap-4 border-t border-muted px-4 py-4">
    <!-- display name + note (fall back to the derived label/detail) -->
    <div class="flex flex-col gap-2">
      <input
        :value="step.label ?? ''"
        :placeholder="def.label"
        spellcheck="false"
        :disabled="!editable"
        aria-label="Step name"
        class="w-full bg-transparent text-sm font-medium text-highlighted outline-none placeholder:text-dimmed"
        @input="onLabelInput(($event.target as HTMLInputElement).value)"
      >
      <input
        :value="step.description ?? ''"
        placeholder="Add a note (optional)"
        spellcheck="false"
        :disabled="!editable"
        aria-label="Step note"
        class="w-full bg-transparent text-xs text-muted outline-none placeholder:text-dimmed"
        @input="record.description = ($event.target as HTMLInputElement).value"
      >
      <!-- the id templates reference this step under; invalid edits stay in
           the draft (red) and revert on blur -->
      <div
        class="flex items-baseline"
        :title="`Templates reference this step as steps.${step.id}`"
      >
        <span class="k-mono text-2xs text-dimmed">steps.</span>
        <input
          :value="idDraft"
          spellcheck="false"
          :disabled="!editable"
          aria-label="Step id"
          class="k-mono min-w-0 flex-1 bg-transparent text-2xs outline-none"
          :class="idError ? 'text-(--accent-orange)' : 'text-muted'"
          @input="onIdInput(($event.target as HTMLInputElement).value)"
          @blur="idDraft = step.id ?? ''"
        >
        <span
          v-if="idError"
          class="flex-none text-2xs text-(--accent-orange)"
        >{{ idError }}</span>
      </div>
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
        :invalid="fieldInvalid(f)"
        @focus="focused = i"
      />
    </template>
    <p
      v-else-if="!isComposite(step)"
      class="text-xs text-muted"
    >
      {{ meta.detail }}. This step has no settings.
    </p>

    <!-- composite steps: conditions + nested step lists -->
    <template v-if="step.type === 'if'">
      <WorkflowConditionEditor
        ref="conditionEditor"
        :step="step"
        :groups="groups"
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

    <!-- error policy (StepMeta): every action carries these -->
    <div
      v-if="!isComposite(step)"
      class="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-muted pt-3.5"
    >
      <div class="flex items-center gap-2">
        <span class="k-label">Timeout</span>
        <UInput
          :model-value="step.timeoutSeconds != null ? String(step.timeoutSeconds) : ''"
          type="number"
          :min="1"
          :max="21600"
          :disabled="!editable"
          :placeholder="String(defaultStepTimeout(step.type))"
          class="w-24"
          :ui="{ base: 'k-mono text-xs' }"
          @update:model-value="onTimeoutInput(String($event))"
        />
        <span class="text-2xs text-dimmed">s</span>
      </div>
      <USwitch
        :model-value="step.continueOnError ?? false"
        :disabled="!editable"
        label="Continue on error"
        @update:model-value="policy.continueOnError = $event"
      />
    </div>

    <!-- available variables (n8n-style): context + prior steps' outputs -->
    <div
      v-if="hasVarFields"
      class="border-t border-muted pt-3.5"
    >
      <button
        type="button"
        :aria-expanded="varsOpen"
        class="group flex w-full cursor-pointer items-center gap-2"
        @click="varsOpen = !varsOpen"
      >
        <UIcon
          name="i-lucide-braces"
          class="size-3.5 flex-none text-dimmed"
        />
        <span class="k-label transition-colors group-hover:text-muted">Variables</span>
        <span class="k-mono flex-none rounded-full border border-muted px-1.5 text-3xs leading-4 text-dimmed">{{ varCount }}</span>
        <span class="min-w-0 flex-1" />
        <span class="truncate text-2xs text-dimmed">click to insert, or type <span class="k-mono text-muted">{{ '\{\{' }}</span> in a field</span>
        <UIcon
          name="i-lucide-chevron-down"
          class="size-3.5 flex-none text-dimmed transition-transform duration-300"
          :class="{ 'rotate-180': varsOpen }"
        />
      </button>
      <!-- Aligned two-column list: a fixed label column (truncated, but the
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
                <span class="truncate text-2xs text-dimmed">{{ g.label }}</span>
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
                    class="k-mono rounded-sm border border-[color-mix(in_oklab,var(--chip-accent)_22%,var(--border-default))] bg-(--surface-base) px-2 py-1 text-2xs transition-colors hover:border-[color-mix(in_oklab,var(--chip-accent)_60%,var(--border-default))] disabled:cursor-not-allowed disabled:opacity-50"
                    @click="insert(v.path)"
                  >
                    <span class="text-dimmed">{{ varPathParts(v.path)[0] }}</span><span class="text-(--chip-accent)">{{ varPathParts(v.path)[1] }}</span>
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
