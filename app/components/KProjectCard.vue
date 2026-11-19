<script setup lang="ts">
import type { ProjectActivity, ProjectRunSummary } from '~/utils/dashboard'
import type { RunStats } from '#shared/utils/run-stats'
import type { IntegrationId } from '#shared/utils/integrations'
import { computed } from 'vue'
import { projectStatusMeta, projectIntegrations } from '~/utils/dashboard'
import KProjectTitle from '~/components/KProjectTitle.vue'
import KStatusBadge from '~/components/KStatusBadge.vue'
import KRunSparkline from '~/components/KRunSparkline.vue'
import KRunStatsText from '~/components/KRunStatsText.vue'
import KIntegrationIcons from '~/components/KIntegrationIcons.vue'
import { UIcon, UTooltip, NuxtLink } from '#components'

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
    class="k-card k-lift flex h-full flex-col gap-3.5 px-4.5 pb-3.5 pt-4.5"
  >
    <div class="flex items-start gap-3">
      <KProjectTitle
        :full-name="fullName"
        :private="private"
        :framework="framework"
        :framework-version="frameworkVersion"
        :favicon="favicon"
        class="flex-1"
      />
      <KStatusBadge :meta="status" />
    </div>

    <div class="mt-auto flex items-end gap-3 pt-4">
      <KRunSparkline
        :stats="stats"
        class="h-9 w-44"
      />
      <KRunStatsText
        :stats="stats"
        class="ml-auto flex-none"
      />
    </div>

    <div class="flex items-center gap-3.5 border-t border-muted pt-3 text-xs text-muted tabular-nums">
      <UTooltip text="Live previews">
        <span
          class="flex items-center gap-1.5"
          :class="activity?.live ? 'text-primary' : ''"
        >
          <UIcon
            name="i-lucide-globe"
            class="size-3.5"
          />{{ activity?.live ?? 0 }}
        </span>
      </UTooltip>
      <UTooltip text="Open sessions">
        <span class="flex items-center gap-1.5">
          <UIcon
            name="i-lucide-play"
            class="size-3.5"
          />{{ activity?.open ?? 0 }}
        </span>
      </UTooltip>
      <UTooltip text="Open pull requests">
        <span class="flex items-center gap-1.5">
          <UIcon
            name="i-lucide-git-pull-request"
            class="size-3.5"
          />{{ activity?.prs ?? 0 }}
        </span>
      </UTooltip>
      <KIntegrationIcons
        :items="projectIntegrations(repoProvider, links)"
        class="ml-auto"
      />
    </div>
  </NuxtLink>
</template>
