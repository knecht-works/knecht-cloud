<script setup lang="ts">
import type { RunStats } from '#shared/utils/run-stats'

defineProps<{
  stats?: RunStats | null
  avg?: string | null
}>()
</script>

<template>
  <div class="text-right text-xs leading-snug text-muted tabular-nums">
    {{ stats?.total ?? 0 }} runs / 14d<br>
    {{ stats?.rate.value == null ? '–' : `${stats.rate.value}%` }} ok<template v-if="avg">
      · {{ avg }}
    </template>
  </div>
</template>
