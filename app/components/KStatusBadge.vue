<script setup lang="ts">
import type { RunStatusMeta } from '~/utils/dashboard'
import { DOT_COLOR_VAR } from '~/utils/dashboard'

defineProps<{
  meta: RunStatusMeta
}>()
</script>

<template>
  <span
    class="flex flex-none items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
    :style="{ color: meta.text, background: `color-mix(in srgb, ${DOT_COLOR_VAR[meta.dot]} 12%, transparent)` }"
  >
    <KStatusDot
      :color="meta.dot"
      :pulse="meta.pulse"
      :glow="false"
    />
    {{ meta.label }}
  </span>
</template>
