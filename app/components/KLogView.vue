<script setup lang="ts">
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
