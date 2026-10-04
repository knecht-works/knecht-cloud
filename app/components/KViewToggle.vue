<script setup lang="ts">
const model = defineModel<'grid' | 'list'>({ required: true })

const OPTIONS = [
  { value: 'grid', icon: 'i-lucide-layout-grid', label: 'Card view' },
  { value: 'list', icon: 'i-lucide-list', label: 'List view' },
] as const
</script>

<template>
  <div class="flex gap-2">
    <UTooltip
      v-for="o in OPTIONS"
      :key="o.value"
      :text="o.label"
    >
      <UButton
        :icon="o.icon"
        :aria-label="o.label"
        :aria-pressed="model === o.value"
        color="neutral"
        :variant="model === o.value ? 'outline' : 'ghost'"
        size="sm"
        class="size-8 justify-center"
        @click="model = o.value"
      />
    </UTooltip>
  </div>
</template>
