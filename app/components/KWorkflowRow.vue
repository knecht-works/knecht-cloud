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
    class="k-card k-lift @container block px-5 py-3.5"
    :style="{ opacity: enabled ? 1 : 0.6 }"
  >
    <div class="flex items-center gap-4 @4xl:gap-6">
      <KWorkflowTitle
        :name="name"
        :step-count="steps.length"
        class="min-w-0 flex-1 @4xl:w-56 @4xl:flex-none"
      />

      <KIntegrationIcons
        :items="triggers"
        class="hidden w-24 flex-none @xl:flex"
      />

      <KStepChain
        :steps="steps"
        class="hidden flex-1 @3xl:flex"
      />

      <KProjectChips
        :projects="projects"
        class="hidden w-40 flex-none @6xl:block"
      />

      <div class="hidden flex-none items-center gap-3 @5xl:flex">
        <KRunSparkline
          :stats="stats"
          class="h-7 w-28"
        />
        <KRunStatsText
          :stats="stats"
          :avg="avg"
          class="w-28"
        />
      </div>

      <div class="flex w-24 flex-none justify-end">
        <KStatusBadge
          v-if="status"
          :meta="status"
        />
      </div>

      <KAutomationToggle
        :enabled="enabled"
        @toggle="emit('toggle')"
      />
    </div>
  </NuxtLink>
</template>
