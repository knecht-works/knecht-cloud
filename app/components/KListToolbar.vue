<script setup lang="ts" generic="S extends string">
import type { FilterCondition, FilterFields } from '#shared/utils/filter'
import { computed } from 'vue'

const props = defineProps<{
  sortOptions: { value: S, label: string }[]
  fields: FilterFields
  options: Record<string, { value: string, label: string }[]>
}>()

const sort = defineModel<S>('sort', { required: true })
const filters = defineModel<FilterCondition[]>('filters', { required: true })
const view = defineModel<'grid' | 'list'>('view', { required: true })

// USelect's item typing can't follow a generic value type, so the select works on plain strings.
const sortItems = computed(() => props.sortOptions as { value: string, label: string }[])
const sortValue = computed({
  get: (): string => sort.value,
  set: (value: string) => {
    sort.value = value as S
  },
})
</script>

<template>
  <div class="flex items-start gap-2">
    <USelect
      v-model="sortValue"
      :items="sortItems"
      color="neutral"
      variant="outline"
      aria-label="Sort"
      size="sm"
      class="w-40"
    />
    <KFilterBuilder
      v-model="filters"
      :fields="fields"
      :options="options"
    />
    <KFilterChips
      v-model="filters"
      :fields="fields"
      :options="options"
      class="min-h-8 min-w-0 flex-1"
    />
    <KViewToggle v-model="view" />
  </div>
</template>
