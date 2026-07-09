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
const stickToBottom = ref(true)

// Within a few px of the bottom counts as "at the bottom": scrollTop can be
// off by a subpixel, and without the slack the flag never latches.
function onScroll() {
  const node = el.value
  if (!node) return
  stickToBottom.value = node.scrollTop + node.clientHeight >= node.scrollHeight - 8
}

// nextTick so the new text is in the DOM before scrollHeight is read;
// immediate so the view starts at the end when it first renders. Instant
// scrolling on purpose: a smooth animation fires scroll events at positions
// that are "not at the bottom" and would unlatch the flag mid-flight.
watch(() => props.log, async () => {
  if (!stickToBottom.value) return
  await nextTick()
  el.value?.scrollTo({ top: el.value.scrollHeight })
}, { immediate: true })
</script>

<template>
  <div
    ref="el"
    class="k-mono overflow-auto whitespace-pre-wrap text-muted"
    :style="{ maxHeight: `${maxHeight}px` }"
    @scroll="onScroll"
  >
    {{ log || '…' }}
  </div>
</template>
