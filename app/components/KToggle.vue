<script setup lang="ts">
// The small pill switch used for automation/trigger toggles. Clicks are
// stopped and prevented so the toggle works inside link rows (WorkflowRow).
// Pass aria-label at the call site; it falls through to the button.
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
    class="relative h-[19px] w-[34px] flex-none cursor-pointer rounded-full border border-(--border-default) transition-colors"
    :style="{ background: active ? 'var(--primary)' : 'var(--surface-accented)' }"
    @click.stop.prevent="emit('toggle')"
  >
    <span
      class="absolute top-0.5 size-[13px] rounded-full transition-all"
      :style="{ left: active ? '17px' : '2px', background: active ? 'var(--accent-ink)' : 'var(--text-dimmed)' }"
    />
  </button>
</template>
