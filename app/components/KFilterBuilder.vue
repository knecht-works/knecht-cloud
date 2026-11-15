<script setup lang="ts">
import { isCompleteCondition, type FilterCondition, type FilterFields } from '#shared/utils/filter'

const props = defineProps<{
  fields: FilterFields
  options: Record<string, { value: string, label: string }[]>
}>()

const conditions = defineModel<FilterCondition[]>({ required: true })

const active = computed(() => conditions.value.filter(isCompleteCondition).length)

const fieldItems = computed(() => Object.entries(props.fields).map(([value, f]) => ({ value, label: f.label })))

function newCondition(field: string): FilterCondition {
  return { field, op: props.fields[field]?.ops[0] ?? 'is', value: '' }
}

function opItems(field: string): string[] {
  return [...props.fields[field]?.ops ?? []]
}

function setField(i: number, field: string) {
  conditions.value = conditions.value.map((c, ci) => ci === i ? newCondition(field) : c)
}

function update(i: number, patch: Partial<FilterCondition>) {
  conditions.value = conditions.value.map((c, ci) => ci === i ? { ...c, ...patch } : c)
}

function remove(i: number) {
  conditions.value = conditions.value.filter((_, ci) => ci !== i)
}

function add(field: string) {
  conditions.value = [...conditions.value, newCondition(field)]
}

const open = ref(false)

watch(open, (isOpen) => {
  const first = fieldItems.value[0]
  if (isOpen && !conditions.value.length && first) add(first.value)
  if (!isOpen) conditions.value = conditions.value.filter(isCompleteCondition)
})

const addItems = computed(() => fieldItems.value.map(f => ({ label: f.label, onSelect: () => add(f.value) })))
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
            :items="fieldItems"
            value-key="value"
            :search-input="false"
            aria-label="Field"
            size="sm"
            class="w-36 shrink-0"
            @update:model-value="(field: string) => setField(i, field)"
          />
          <USelectMenu
            :model-value="c.op"
            :items="opItems(c.field)"
            :search-input="false"
            aria-label="Operator"
            size="sm"
            class="w-24 shrink-0"
            @update:model-value="(op: string) => update(i, { op })"
          />
          <UInput
            v-if="fields[c.field]?.input === 'version'"
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
            :items="options[c.field] ?? []"
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
