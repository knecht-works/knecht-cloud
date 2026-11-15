<script setup lang="ts">
import type { RunStats } from '#shared/utils/run-stats'

const props = defineProps<{
  stats?: RunStats | null
}>()

const points = computed(() => {
  const daily = props.stats?.days.map(d => d.success + d.failed) ?? Array.from({ length: 14 }, () => 0)
  const max = Math.max(...daily) || 1
  const step = 100 / (daily.length - 1)
  return daily.map((v, i) => `${i * step},${34 - (v / max) * 32}`).join(' ')
})
</script>

<template>
  <svg
    viewBox="0 0 100 36"
    preserveAspectRatio="none"
    class="min-w-0"
    :class="(stats?.rate.value ?? 100) < 80 ? 'text-error' : 'text-primary'"
    aria-hidden="true"
  >
    <polyline
      :points="points"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
