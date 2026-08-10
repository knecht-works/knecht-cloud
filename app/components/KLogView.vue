<script setup lang="ts">
// Scrollable log output that follows new content: stays pinned to the bottom
// while the user is at (or near) it, pauses when they scroll up, re-engages
// when they scroll back down. Text styling and padding vary per usage and
// fall through as classes; the height is capped via maxHeight.
const props = withDefaults(defineProps<{
  log: string | null | undefined
  maxHeight?: number
}>(), {
  maxHeight: 420,
})

const el = ref<HTMLElement | null>(null)
const { onScroll } = useStickToBottom(el, () => props.log)
</script>

<template>
  <div
    ref="el"
    class="k-mono k-scrollbar-none overflow-auto whitespace-pre-wrap text-muted"
    :style="{ maxHeight: `${maxHeight}px` }"
    @scroll="onScroll"
  >
    {{ log || '…' }}
  </div>
</template>
