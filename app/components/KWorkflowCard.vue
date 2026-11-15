<script setup lang="ts">
import type { RunStatusMeta, WorkflowStep } from '~/utils/dashboard'
import type { RunStats } from '#shared/utils/run-stats'

defineProps<{
  id: number
  name: string
  steps: WorkflowStep[]
  status: RunStatusMeta | null
  triggers: { icon: string, label: string, color: string }[]
  enabled: boolean
  stats?: RunStats | null
  avg: string | null
  projects: string[]
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <NuxtLink
    :to="`/workflows/${id}`"
    class="k-card k-lift flex h-full flex-col gap-3.5 px-4.5 pb-3.5 pt-4.5"
    :style="{ opacity: enabled ? 1 : 0.6 }"
  >
    <div class="flex items-start gap-3">
      <KWorkflowTitle
        :name="name"
        class="min-w-0 flex-1"
      >
        <KProjectChips
          :projects="projects"
          class="mt-1"
        />
      </KWorkflowTitle>
      <KStatusBadge
        v-if="status"
        :meta="status"
      />
    </div>

    <div class="my-auto flex flex-col gap-2.5 py-1">
      <KStepChain
        :steps="steps"
        large
      />
      <KRunStatsText
        :stats="stats"
        :avg="avg"
        inline
      />
    </div>

    <div class="flex items-center border-t border-muted pt-3">
      <KIntegrationIcons :items="triggers" />
      <KAutomationToggle
        :enabled="enabled"
        class="ml-auto"
        @toggle="emit('toggle')"
      />
    </div>
  </NuxtLink>
</template>
