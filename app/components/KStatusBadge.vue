<script setup lang="ts">
import type { RunStatusMeta } from '~/utils/dashboard'
import { DOT_COLOR_VAR } from '~/utils/dashboard'
import KStatusDot from '~/components/KStatusDot.vue'

defineProps<{
  meta: RunStatusMeta
  size?: 'md'
}>()
</script>

<template>
  <span
    class="flex flex-none items-center rounded-full"
    :class="size === 'md' ? 'gap-2 px-3 py-0.5 text-sm' : 'gap-1.5 px-2 py-0.5 text-xs'"
    :style="{ color: meta.text, background: `color-mix(in srgb, ${DOT_COLOR_VAR[meta.dot]} 12%, transparent)` }"
  >
    <KStatusDot
      :color="meta.dot"
      :pulse="meta.pulse"
      :glow="false"
      :size="size === 'md' ? 7 : 6"
    />
    {{ meta.label }}
  </span>
</template>
