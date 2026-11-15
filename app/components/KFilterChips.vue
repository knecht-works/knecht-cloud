<script setup lang="ts">
import { isCompleteCondition, type FilterCondition, type FilterFields } from '#shared/utils/filter'

const props = defineProps<{
  fields: FilterFields
  options: Record<string, { value: string, label: string }[]>
}>()

const conditions = defineModel<FilterCondition[]>({ required: true })

function valueLabel(c: FilterCondition) {
  return props.options[c.field]?.find(o => o.value === c.value)?.label ?? c.value
}

const chips = computed(() => conditions.value.flatMap((c, i) => isCompleteCondition(c) ? [{ c, i }] : []))

function remove(i: number) {
  conditions.value = conditions.value.filter((_, ci) => ci !== i)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <span
      v-for="{ c, i } in chips"
      :key="i"
      class="flex h-8 items-center gap-1 rounded-md bg-(--surface-accented) pl-2.5 pr-1.5 text-sm"
    >
      <span class="text-toned">{{ fields[c.field]?.label ?? c.field }} {{ c.op }}</span>
      <span class="font-medium text-highlighted">{{ valueLabel(c) }}</span>
      <button
        type="button"
        class="ml-0.5 grid size-5 place-items-center rounded text-muted transition-colors hover:text-highlighted cursor-pointer"
        aria-label="Remove filter"
        @click="remove(i)"
      >
        <UIcon
          name="i-lucide-x"
          class="size-3.5"
        />
      </button>
    </span>
  </div>
</template>
