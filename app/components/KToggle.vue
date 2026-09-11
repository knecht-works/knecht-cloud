<script setup lang="ts">
defineProps<{
  active: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="active"
    :disabled="disabled"
    class="relative h-5 w-9 flex-none cursor-pointer rounded-full border border-default transition-colors"
    :style="{ background: active ? 'var(--primary)' : 'var(--surface-accented)' }"
    @click.stop.prevent="emit('toggle')"
  >
    <span
      class="absolute top-0.5 size-3.5 rounded-full transition-all"
      :style="{ left: active ? '18px' : '2px', background: active ? 'var(--accent-ink)' : 'var(--text-dimmed)' }"
    />
  </button>
</template>
