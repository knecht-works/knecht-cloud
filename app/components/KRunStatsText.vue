<script setup lang="ts">
import type { RunStats } from '#shared/utils/run-stats'

defineProps<{
  stats?: RunStats | null
  avg?: string | null
  inline?: boolean
}>()
</script>

<template>
  <div
    class="text-xs leading-snug text-muted tabular-nums"
    :class="inline ? '' : 'text-right'"
  >
    {{ stats?.total ?? 0 }} runs / 14d<template v-if="inline">
      ·
    </template><br v-else>
    {{ stats?.rate.value == null ? '–' : `${stats.rate.value}%` }} ok<template v-if="avg">
      · {{ avg }}
    </template>
  </div>
</template>
