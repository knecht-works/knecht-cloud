<script setup lang="ts">
import type { ProjectActivity, ProjectRunSummary } from '~/utils/dashboard'
import type { RunStats } from '#shared/utils/run-stats'
import type { IntegrationId } from '#shared/utils/integrations'
import { computed } from 'vue'
import { projectStatusMeta, projectIntegrations } from '~/utils/dashboard'

const props = defineProps<{
  id: number
  fullName: string
  private: boolean
  framework?: string | null
  frameworkVersion?: string | null
  favicon?: string | null
  latest?: ProjectRunSummary | null
  stats?: RunStats | null
  activity?: ProjectActivity | null
  links?: Partial<Record<IntegrationId, string>>
  repoProvider: IntegrationId
}>()

const status = computed(() => projectStatusMeta(props.latest))
</script>

<template>
  <NuxtLink
    :to="`/projects/${id}`"
    class="k-card k-lift flex items-center gap-8 overflow-hidden px-5 py-3.5"
  >
    <KProjectTitle
      :full-name="fullName"
      :private="private"
      :framework="framework"
      :framework-version="frameworkVersion"
      :favicon="favicon"
      class="flex-[1.4]"
    />

    <div class="hidden min-w-0 flex-1 items-center gap-4 lg:flex">
      <KRunSparkline
        :stats="stats"
        class="h-7 max-w-52 flex-1"
      />
      <KRunStatsText
        :stats="stats"
        class="w-20 flex-none"
      />
    </div>

    <div class="hidden flex-1 items-center justify-center gap-5 text-xs text-muted tabular-nums md:flex">
      <UTooltip text="Live previews">
        <span
          class="flex w-8 items-center gap-1.5"
          :class="activity?.live ? 'text-primary' : ''"
        >
          <UIcon
            name="i-lucide-globe"
            class="size-3.5"
          />{{ activity?.live ?? 0 }}
        </span>
      </UTooltip>
      <UTooltip text="Open sessions">
        <span class="flex w-8 items-center gap-1.5">
          <UIcon
            name="i-lucide-play"
            class="size-3.5"
          />{{ activity?.open ?? 0 }}
        </span>
      </UTooltip>
      <UTooltip text="Open pull requests">
        <span class="flex w-8 items-center gap-1.5">
          <UIcon
            name="i-lucide-git-pull-request"
            class="size-3.5"
          />{{ activity?.prs ?? 0 }}
        </span>
      </UTooltip>
    </div>

    <KIntegrationIcons
      :items="projectIntegrations(repoProvider, links)"
      class="hidden w-28 flex-none xl:flex"
    />

    <div class="flex w-24 flex-none justify-end">
      <KStatusBadge :meta="status" />
    </div>

    <UIcon
      name="i-lucide-chevron-right"
      class="size-4 flex-none text-dimmed"
    />
  </NuxtLink>
</template>
