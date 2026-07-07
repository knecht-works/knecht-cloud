<script setup lang="ts" generic="T extends string | null">
// The rounded filter pills above list views (framework filter, workflow tabs).
defineProps<{
  items: { value: T, label: string }[]
}>()

const model = defineModel<T>({ required: true })
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="item in items"
      :key="String(item.value)"
      type="button"
      class="k-mono cursor-pointer rounded-full px-2.5 py-1 text-[11.5px] transition-colors"
      :class="model === item.value
        ? 'border border-(--border-default) bg-(--surface-glass) text-(--text-muted)'
        : 'border border-transparent text-(--text-dimmed) hover:text-(--text-muted)'"
      @click="model = item.value"
    >
      {{ item.label }}
    </button>
  </div>
</template>
