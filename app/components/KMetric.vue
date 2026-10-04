<script setup lang="ts">
defineProps<{
  value: string
  label: string
  delta?: string | null
  deltaColor?: string
}>()
</script>

<template>
  <div class="k-card flex items-end gap-8 p-6">
    <div class="flex min-w-0 flex-col gap-2">
      <span class="k-label whitespace-nowrap leading-none">{{ label }}</span>
      <div class="flex items-baseline gap-2">
        <span class="k-mono whitespace-nowrap text-3xl/none font-bold tracking-tight text-highlighted">{{ value }}</span>
        <span
          v-if="delta"
          class="k-mono text-sm leading-none"
          :style="{ color: deltaColor }"
        >{{ delta }}</span>
      </div>
    </div>
    <div class="ml-auto flex min-w-0 flex-1 justify-end">
      <slot />
    </div>
  </div>
</template>
