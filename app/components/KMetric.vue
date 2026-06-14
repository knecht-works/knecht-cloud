<script setup lang="ts">
// A headline metric: a big tabular mono number with an optional suffix and an
// uppercase mono caption underneath. Sits in the overview's stat row.
withDefaults(defineProps<{
  value: string | number
  label: string
  suffix?: string
  accent?: string
}>(), {})
</script>

<template>
  <div class="k-card flex-1 p-5">
    <div
      class="k-mono text-[32px] font-bold leading-none tracking-[-0.02em]"
      :style="{ color: accent ?? 'var(--text-highlighted)' }"
    >
      {{ value }}<span
        v-if="suffix"
        class="text-base font-medium text-(--text-dimmed)"
      >{{ suffix }}</span>
    </div>
    <div class="k-label mt-2.5">
      {{ label }}
    </div>
  </div>
</template>
