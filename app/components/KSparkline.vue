<script setup lang="ts">
const props = defineProps<{
  values: number[]
}>()

const gradientId = useId()

const points = computed(() => {
  const min = Math.min(...props.values)
  const span = Math.max(...props.values) - min || 1
  const step = 100 / (props.values.length - 1)
  return props.values.map((v, i) => [i * step, 95 - ((v - min) / span) * 90] as const)
})

// Monotone cubic (Fritsch-Carlson): smooth without overshooting past the data range.
const line = computed(() => {
  const p = points.value
  const h = p[1]![0] - p[0]![0]
  const slopes = p.slice(1).map(([, y], i) => (y - p[i]![1]) / h)
  const tangents = p.map((_, i) => {
    const a = slopes[i - 1] ?? slopes[i]!
    const b = slopes[i] ?? slopes[i - 1]!
    return a * b > 0 ? (2 * a * b) / (a + b) : 0
  })
  return p.slice(1).reduce((path, [x, y], i) => {
    const [x0, y0] = p[i]!
    return `${path} C${x0 + h / 3},${y0 + (tangents[i]! * h) / 3} ${x - h / 3},${y - (tangents[i + 1]! * h) / 3} ${x},${y}`
  }, `M${p[0]!.join(',')}`)
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
      <defs>
        <linearGradient
          :id="gradientId"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop
            offset="0"
            stop-color="var(--primary)"
            stop-opacity="0.22"
          />
          <stop
            offset="1"
            stop-color="var(--primary)"
            stop-opacity="0"
          />
        </linearGradient>
      </defs>
      <path
        :d="`${line} L100,100 L0,100 Z`"
        :fill="`url(#${gradientId})`"
      />
      <path
        :d="line"
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
      :style="{ top: `${points.at(-1)![1]}%`, boxShadow: '0 0 8px var(--primary)' }"
    />
  </div>
</template>
