import type { Ref } from 'vue'

// Stick-to-bottom latch for streaming log panes (KLogView, KRunLog): pinned
// to the bottom while the user is at (or near) it, paused when they scroll
// up, re-engaged when they scroll back down. `content` is the watched text
// source; wire the returned onScroll to the container's @scroll.
export function useStickToBottom(el: Ref<HTMLElement | null>, content: () => unknown) {
  const stick = ref(true)

  // Within a few px of the bottom counts as "at the bottom": scrollTop can be
  // off by a subpixel, and without the slack the flag never latches.
  function onScroll() {
    const node = el.value
    if (!node) return
    stick.value = node.scrollTop + node.clientHeight >= node.scrollHeight - 8
  }

  // nextTick so the new text is in the DOM before scrollHeight is read;
  // immediate so the view starts at the tail. Instant scrolling on purpose: a
  // smooth animation fires scroll events at positions that are "not at the
  // bottom" and would unlatch the flag mid-flight.
  watch(content, async () => {
    if (!stick.value) return
    await nextTick()
    el.value?.scrollTo({ top: el.value.scrollHeight })
  }, { immediate: true })

  return { stick, onScroll }
}
