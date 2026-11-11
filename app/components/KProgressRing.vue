<script setup lang="ts">
const props = withDefaults(defineProps<{ value: number, size?: number }>(), { size: 16 })

const R = 6.5
const CIRCUMFERENCE = 2 * Math.PI * R
const offset = computed(() => CIRCUMFERENCE * (1 - Math.min(Math.max(props.value, 0), 1)))
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    class="flex-none -rotate-90"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(value * 100)"
  >
    <circle
      cx="8"
      cy="8"
      :r="R"
      fill="none"
      stroke-width="2"
      stroke="currentColor"
      stroke-opacity="0.2"
    />
    <circle
      cx="8"
      cy="8"
      :r="R"
      fill="none"
      stroke-width="2"
      stroke-linecap="round"
      class="stroke-primary transition-[stroke-dashoffset] duration-200 motion-reduce:transition-none"
      :stroke-dasharray="CIRCUMFERENCE"
      :stroke-dashoffset="offset"
    />
  </svg>
</template>
