<script setup lang="ts">
import type { TriggerSegment } from '#shared/utils/trigger-form'

const props = defineProps<{ segments: TriggerSegment[] }>()

// "is" goes without saying next to a chip; "is not" shrinks to an orange "not".
const shown = computed(() => props.segments
  .filter(s => s.kind !== 'op' && s.text.trim())
  .map(s => (s.kind === 'not' ? { ...s, text: 'not' } : { ...s, text: s.text.trim() })))
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1.5">
    <span
      v-for="(segment, i) in shown"
      :key="i"
      :class="{
        'k-code': segment.kind === 'value',
        'text-accent-orange': segment.kind === 'not',
      }"
    >{{ segment.text }}</span>
  </span>
</template>
