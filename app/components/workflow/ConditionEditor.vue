<script setup lang="ts">
import { CONDITION_OPS, type Condition, type ConditionOp } from '#shared/utils/workflow'

// The if step's condition editor: OR groups of AND rows, edited in place on
// the draft (like every other step param). Both sides are {{ }} templates;
// the operator compares the rendered strings.
const props = defineProps<{
  step: Extract<WorkflowStep, { type: 'if' }>
  /** Variable groups visible at the if step (both sides are templates). */
  groups: VarGroup[]
  editable: boolean
}>()

// Both sides get the {{ }} treatment: unlabeled (compact) VarFields, so the
// autocomplete and the inspector's chip inserts work like in any other field.
const LEFT_FIELD: StepField = { key: 'left', label: '', input: 'text', vars: true, placeholder: '{{ steps.s2.exitCode }}' }
const RIGHT_FIELD: StepField = { key: 'right', label: '', input: 'text', vars: true, placeholder: '0' }

// Chip inserts go to the last-focused side (falling back to the first row),
// mirroring StepSettings' field wiring; rows are dynamic, so refs live in a
// map keyed by group/row/side.
interface VarFieldApi { insertVar: (path: string) => void }
const fieldRefs = new Map<string, VarFieldApi>()
const focused = ref<string | null>(null)

function setRef(key: string, el: unknown) {
  if (el) fieldRefs.set(key, el as VarFieldApi)
  else fieldRefs.delete(key)
}

function insertVar(path: string) {
  const target = (focused.value ? fieldRefs.get(focused.value) : undefined) ?? fieldRefs.values().next().value
  target?.insertVar(path)
}

defineExpose({ insertVar })

const OP_LABELS: Record<ConditionOp, string> = {
  'eq': 'equals',
  'neq': 'not equals',
  'contains': 'contains',
  'not-contains': 'doesn\'t contain',
  'empty': 'is empty',
  'not-empty': 'is not empty',
  'gt': '>',
  'lt': '<',
  'regex': 'matches regex',
}
const OP_ITEMS = CONDITION_OPS.map(op => ({ label: OP_LABELS[op], value: op }))

// Conditions are edited in place: the draft object owns the state, the same
// contract as StepSettings' `record`.
const conditions = computed(() => props.step.conditions)

// Empty left sides highlight only once the step is touched (stepPristine)
// or a failed save flips FORCE_STEP_ISSUES: a just-added if starts with one
// blank row and shouldn't open in orange.
const forced = inject(FORCE_STEP_ISSUES, () => ref(false), true)
const pristine = computed(() => stepPristine(props.step))

// empty / not-empty have no right-hand side.
function hasRight(op: ConditionOp): boolean {
  return op !== 'empty' && op !== 'not-empty'
}

function addCondition(group: Condition[]) {
  group.push({ left: '', op: 'eq', right: '' })
}

function addGroup() {
  conditions.value.push([{ left: '', op: 'eq', right: '' }])
}

function removeCondition(gi: number, ci: number) {
  const group = conditions.value[gi]!
  group.splice(ci, 1)
  if (!group.length && conditions.value.length > 1) {
    conditions.value.splice(gi, 1)
  }
}
</script>

<template>
  <div>
    <span class="k-label">Conditions<span class="text-dimmed"> *</span></span>
    <div class="mt-1.5 flex flex-col gap-2">
      <template
        v-for="(group, gi) in step.conditions"
        :key="gi"
      >
        <div
          v-if="gi > 0"
          class="k-mono text-3xs uppercase tracking-widest text-dimmed"
        >
          or
        </div>
        <div class="flex flex-col gap-1.5 rounded-md border border-muted p-2">
          <div
            v-for="(c, ci) in group"
            :key="ci"
            class="flex items-center gap-1.5"
          >
            <WorkflowVarField
              :ref="(el: unknown) => setRef(`${gi}:${ci}:left`, el)"
              v-model="c.left"
              :field="LEFT_FIELD"
              :groups="groups"
              :disabled="!editable"
              :invalid="(forced || !pristine) && !c.left.trim()"
              class="min-w-0 flex-1"
              @focus="focused = `${gi}:${ci}:left`"
            />
            <USelect
              v-model="c.op"
              :items="OP_ITEMS"
              :disabled="!editable"
              class="w-36 flex-none"
              :ui="{ base: 'text-xs' }"
            />
            <WorkflowVarField
              v-if="hasRight(c.op)"
              :ref="(el: unknown) => setRef(`${gi}:${ci}:right`, el)"
              v-model="c.right"
              :field="RIGHT_FIELD"
              :groups="groups"
              :disabled="!editable"
              class="min-w-0 flex-1"
              @focus="focused = `${gi}:${ci}:right`"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              aria-label="Remove condition"
              :disabled="!editable || (group.length === 1 && step.conditions.length === 1)"
              @click="removeCondition(gi, ci)"
            />
          </div>
          <div>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-plus"
              label="and"
              :disabled="!editable"
              @click="addCondition(group)"
            />
          </div>
        </div>
      </template>
      <div>
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-plus"
          label="or group"
          :disabled="!editable"
          @click="addGroup()"
        />
      </div>
    </div>
  </div>
</template>
