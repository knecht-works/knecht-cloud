<script setup lang="ts">
import { FILTER_FIELD_LABEL, FILTER_OPS, isCompleteCondition, type FilterCondition, type FilterField } from '#shared/utils/project-filter'

interface Option { value: string, label: string }

defineProps<{
  options: Record<Exclude<FilterField, 'version'>, Option[]>
}>()

const conditions = defineModel<FilterCondition[]>({ required: true })

const active = computed(() => conditions.value.filter(isCompleteCondition).length)

const FIELD_ITEMS = (Object.keys(FILTER_FIELD_LABEL) as FilterField[]).map(value => ({ value, label: FILTER_FIELD_LABEL[value] }))

function newCondition(field: FilterField): FilterCondition {
  return { field, op: FILTER_OPS[field][0]!, value: '' }
}

function setField(i: number, field: FilterField) {
  conditions.value = conditions.value.map((c, ci) => ci === i ? newCondition(field) : c)
}

function update(i: number, patch: Partial<FilterCondition>) {
  conditions.value = conditions.value.map((c, ci) => ci === i ? { ...c, ...patch } : c)
}

function remove(i: number) {
  conditions.value = conditions.value.filter((_, ci) => ci !== i)
}

function add(field: FilterField) {
  conditions.value = [...conditions.value, newCondition(field)]
}

const open = defineModel<boolean>('open', { default: false })

watch(open, (isOpen) => {
  if (isOpen && !conditions.value.length) add('stack')
  if (!isOpen) conditions.value = conditions.value.filter(isCompleteCondition)
})

const addItems = FIELD_ITEMS.map(f => ({ label: f.label, onSelect: () => add(f.value) }))
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'start' }"
  >
    <UTooltip text="Filter">
      <UButton
        icon="i-lucide-funnel"
        :color="active ? 'primary' : 'neutral'"
        :variant="active ? 'solid' : 'outline'"
        size="sm"
        aria-label="Filter"
      />
    </UTooltip>
    <template #content>
      <div class="flex w-[30rem] flex-col gap-2 p-3">
        <div
          v-for="(c, i) in conditions"
          :key="i"
          class="flex items-center gap-2"
        >
          <USelectMenu
            :model-value="c.field"
            :items="FIELD_ITEMS"
            value-key="value"
            :search-input="false"
            aria-label="Field"
            size="sm"
            class="w-36 shrink-0"
            @update:model-value="(field: FilterField) => setField(i, field)"
          />
          <USelectMenu
            :model-value="c.op"
            :items="FILTER_OPS[c.field]"
            :search-input="false"
            aria-label="Operator"
            size="sm"
            class="w-24 shrink-0"
            @update:model-value="(op: string) => update(i, { op })"
          />
          <UInput
            v-if="c.field === 'version'"
            :model-value="c.value"
            placeholder="e.g. 5.4.3"
            aria-label="Version"
            size="sm"
            class="min-w-0 flex-1"
            @update:model-value="(value: string | number) => update(i, { value: String(value) })"
          />
          <USelectMenu
            v-else
            :model-value="c.value || undefined"
            :items="options[c.field]"
            value-key="value"
            :search-input="false"
            placeholder="Choose"
            aria-label="Value"
            size="sm"
            class="min-w-0 flex-1"
            @update:model-value="(value: string) => update(i, { value })"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Remove condition"
            @click="remove(i)"
          />
        </div>
        <div>
          <UDropdownMenu :items="addItems">
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              size="sm"
              aria-label="Add condition"
            />
          </UDropdownMenu>
        </div>
      </div>
    </template>
  </UPopover>
</template>
