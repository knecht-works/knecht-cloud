<script setup lang="ts">
defineOptions({ inheritAttrs: false })

defineProps<{
  // Renders a growing textarea instead of a single line.
  rows?: number
}>()

const model = defineModel<string>()

// Mono at the code editor's 12px. The line height is pinned to the one of the
// control size, or the smaller font would make the field shorter than a button.
const attrs = useAttrs()
const base = computed(() => `k-mono [font-size:var(--text-xs)]! ${['xs', 'sm'].includes(attrs.size as string) ? 'leading-4!' : 'leading-5!'}`)
</script>

<template>
  <UTextarea
    v-if="rows"
    v-model="model"
    :rows="rows"
    autoresize
    spellcheck="false"
    v-bind="$attrs"
    :ui="{ base: `${base} resize-none` }"
  />
  <UInput
    v-else
    v-model="model"
    spellcheck="false"
    autocapitalize="off"
    v-bind="$attrs"
    :ui="{ base }"
  />
</template>
