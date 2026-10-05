<script setup lang="ts">
const props = withDefaults(defineProps<{
  color?: keyof typeof DOT_COLOR_VAR
  pulse?: boolean
  glow?: boolean
  size?: number
}>(), {
  color: 'primary',
  pulse: false,
  glow: true,
  size: 6,
})

const c = computed(() => DOT_COLOR_VAR[props.color] ?? DOT_COLOR_VAR.primary)
</script>

<template>
  <span
    class="relative inline-flex flex-none"
    :style="{ width: `${size}px`, height: `${size}px`, color: c }"
  >
    <span
      v-if="pulse"
      class="absolute inset-0 inline-flex h-full w-full rounded-full bg-current opacity-40"
      style="animation: knecht-ping 1.4s cubic-bezier(0,0,0.2,1) infinite"
    />
    <span
      class="relative inline-flex rounded-full bg-current"
      :style="{ width: `${size}px`, height: `${size}px`, boxShadow: glow ? '0 0 8px currentColor' : 'none' }"
    />
  </span>
</template>
