<script setup lang="ts">
defineProps<{
  label: string
  hint?: string
  preset?: boolean
  danger?: boolean
}>()
</script>

<template>
  <div class="grid grid-cols-1 gap-2 py-2.5 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center lg:gap-10 lg:border-b lg:border-muted lg:py-3.5 lg:last:border-0">
    <div class="min-w-0">
      <div
        class="text-sm"
        :class="danger ? 'text-error' : 'text-highlighted'"
      >
        {{ label }}
      </div>
      <p
        v-if="hint || $slots.hint"
        class="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted"
      >
        <slot name="hint">
          {{ hint }}
        </slot>
      </p>
    </div>
    <div class="min-w-0">
      <slot />
      <p
        v-if="preset"
        class="mt-2 text-xs text-dimmed"
      >
        Preset by the installation.
      </p>
    </div>
  </div>
</template>
