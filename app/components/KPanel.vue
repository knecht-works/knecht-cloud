<script setup lang="ts">
// A titled surface panel: a hairline header (icon + uppercase mono label +
// optional action slot) above a body. The detail screen's building block.
const props = withDefaults(defineProps<{
  title: string
  icon?: string
  accent?: string
  pad?: number
}>(), {
  pad: 20,
})
</script>

<template>
  <div class="k-card overflow-hidden">
    <div class="flex items-center gap-2.5 border-b border-(--border-muted) px-[18px] py-3.5">
      <UIcon
        v-if="icon"
        :name="icon"
        class="size-[15px]"
        :style="{ color: accent ?? 'var(--text-dimmed)' }"
      />
      <span class="k-mono text-[11.5px] uppercase tracking-[0.1em] text-(--text-toned)">{{ title }}</span>
      <div
        v-if="$slots.action"
        class="ml-auto"
      >
        <slot name="action" />
      </div>
    </div>
    <div :style="{ padding: `${props.pad}px` }">
      <slot />
    </div>
  </div>
</template>
