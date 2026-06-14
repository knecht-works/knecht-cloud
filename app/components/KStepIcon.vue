<script setup lang="ts">
// A square icon chip on the accented well — the recurring "step" / list glyph
// frame used across the builder, run log and detail panels.
const props = withDefaults(defineProps<{
  icon: string
  color?: string
  size?: number
  radius?: number
}>(), {
  color: 'var(--text-muted)',
  size: 38,
  radius: 9,
})
</script>

<template>
  <span
    class="grid flex-none place-items-center border border-(--border-default) bg-(--surface-accented)"
    :style="{ width: `${props.size}px`, height: `${props.size}px`, borderRadius: `${props.radius}px`, color: props.color }"
  >
    <UIcon
      :name="icon"
      :style="{ fontSize: `${Math.round(props.size * 0.46)}px` }"
    />
  </span>
</template>
