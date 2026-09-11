import type { Ref } from 'vue'

export function useStickToBottom(el: Ref<HTMLElement | null>, content: () => unknown) {
  const stick = ref(true)

  // A few px of slack: scrollTop can be off by a subpixel and the flag would never latch.
  function onScroll() {
    const node = el.value
    if (!node) return
    stick.value = node.scrollTop + node.clientHeight >= node.scrollHeight - 8
  }

  // No smooth scrolling: its scroll events would unlatch the flag mid-flight.
  watch(content, async () => {
    if (!stick.value) return
    await nextTick()
    el.value?.scrollTo({ top: el.value.scrollHeight })
  }, { immediate: true })

  return { stick, onScroll }
}
