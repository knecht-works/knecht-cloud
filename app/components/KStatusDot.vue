<script setup lang="ts">
// The brand's universal "live / status" marker: a tiny glowing dot with an
// optional animated ping ring. Colours map to lifecycle states.
const props = withDefaults(defineProps<{
  color?: 'primary' | 'success' | 'orange' | 'violet' | 'warning' | 'error' | 'neutral'
  pulse?: boolean
  glow?: boolean
  size?: number
}>(), {
  color: 'primary',
  pulse: false,
  glow: true,
  size: 6,
})

const COLOR_VAR: Record<string, string> = {
  primary: 'var(--primary)',
  success: 'var(--primary)',
  orange: 'var(--accent-orange)',
  violet: 'var(--accent-violet)',
  warning: 'var(--accent-violet)',
  error: 'var(--status-error)',
  neutral: 'var(--status-neutral)',
}

const c = computed(() => COLOR_VAR[props.color] ?? COLOR_VAR.primary)
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
