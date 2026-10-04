<script setup lang="ts">
const props = defineProps<{
  values: number[]
}>()

const points = computed(() => {
  const min = Math.min(...props.values)
  const span = Math.max(...props.values) - min || 1
  const step = 100 / (props.values.length - 1)
  return props.values.map((v, i) => [i * step, 95 - ((v - min) / span) * 90] as const)
})
</script>

<template>
  <div
    v-if="values.length > 1"
    class="relative h-11 w-full"
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      class="absolute inset-0 size-full overflow-visible"
    >
      <polyline
        :points="points.map(p => p.join(',')).join(' ')"
        fill="none"
        stroke="var(--primary)"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <span
      class="absolute right-0 size-1.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
      :style="{ top: `${points.at(-1)![1]}%` }"
    />
  </div>
</template>
