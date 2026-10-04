<script setup lang="ts">
const emit = defineEmits<{ start: [e: PointerEvent] }>()
</script>

<template>
  <div
    class="flex h-3 cursor-row-resize touch-none items-center justify-center"
    aria-hidden="true"
    @pointerdown.prevent="emit('start', $event)"
  >
    <span class="h-1 w-10 rounded-full bg-accented" />
  </div>
</template>
