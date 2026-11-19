<script setup lang="ts">
import KStepIcon from '~/components/KStepIcon.vue'

defineProps<{
  name: string
  stepCount?: number
}>()
</script>

<template>
  <div class="flex min-w-0 items-center gap-3">
    <KStepIcon
      icon="i-lucide-workflow"
      color="var(--text-primary)"
      :size="36"
      :radius="9"
    />
    <div class="min-w-0">
      <div class="truncate text-[15px] font-medium leading-tight text-highlighted">
        {{ name }}
      </div>
      <slot>
        <div class="mt-1 truncate text-xs text-muted">
          {{ stepCount }} {{ stepCount === 1 ? 'step' : 'steps' }}
        </div>
      </slot>
    </div>
  </div>
</template>
