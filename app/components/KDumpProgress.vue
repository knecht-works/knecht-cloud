<script setup lang="ts">
import type { DumpProgress } from '~/composables/useProjectDump'
import { UProgress, UButton, UTooltip } from '#components'

defineProps<{
  progress: DumpProgress
  uploading?: boolean
  compact?: boolean
}>()
const emit = defineEmits<{ cancel: [] }>()
</script>

<template>
  <div
    v-if="compact"
    class="w-full"
  >
    <p class="text-xs text-muted">
      {{ progress.label }}{{ progress.short ? ` · ${progress.short}` : '' }}
    </p>
    <UProgress
      :model-value="progress.percent || null"
      size="xs"
      class="mt-2"
    />
  </div>
  <div
    v-else
    class="w-full"
  >
    <div class="flex h-6 items-center gap-2">
      <span class="text-sm font-medium text-default">{{ progress.step }}</span>
      <span class="flex-1 text-left text-sm font-medium text-default">{{ progress.label }}</span>
      <UTooltip :text="uploading ? 'Cancel upload' : 'Cancel import'">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :aria-label="uploading ? 'Cancel upload' : 'Cancel import'"
          @click="emit('cancel')"
        />
      </UTooltip>
    </div>
    <UProgress
      :model-value="progress.percent || null"
      size="xs"
      class="mt-2"
    />
    <p class="mt-2 min-h-8 text-left text-xs leading-4 text-muted">
      {{ progress.detail }}
    </p>
  </div>
</template>
