<script setup lang="ts">
import type { RunStatus } from '~/utils/dashboard'
import type { EnvState, EnvTransition } from '#shared/utils/run'
import type { RunStats } from '#shared/utils/run-stats'
import type { IntegrationId } from '#shared/utils/integrations'

interface RunSummary {
  status: RunStatus
  envState: EnvState
  previewReady: boolean
  envTransition?: EnvTransition | null
  sessionStatus: 'open' | 'closed'
  workflow: string
  createdAt: string | number | Date | null
}

interface Activity {
  open: number
  live: number
  prs: number
}

const props = defineProps<{
  id: number
  fullName: string
  private: boolean
  framework?: string | null
  frameworkVersion?: string | null
  favicon?: string | null
  latest?: RunSummary | null
  stats?: RunStats | null
  activity?: Activity | null
  links?: Partial<Record<IntegrationId, string>>
  repoProvider: IntegrationId
}>()

const parts = computed(() => {
  const [org, ...rest] = props.fullName.split('/')
  return { org, name: rest.join('/') || org }
})

const fw = computed(() => frameworkMeta(props.framework))
const fwLabel = computed(() => props.frameworkVersion ? `${fw.value.label} ${props.frameworkVersion}` : fw.value.label)

const status = computed(() => projectStatusMeta(props.latest))

const integrations = computed(() =>
  [props.repoProvider, ...Object.keys(props.links ?? {}) as IntegrationId[]].map(integrationUi),
)
</script>

<template>
  <NuxtLink
    :to="`/projects/${id}`"
    class="k-card k-lift flex items-center gap-8 overflow-hidden px-5 py-3.5"
  >
    <div class="flex min-w-0 flex-[1.4] items-center gap-3">
      <span
        v-if="favicon"
        class="grid size-9 flex-none place-items-center rounded-lg border border-default bg-(--surface-accented)"
      >
        <img
          :src="favicon"
          alt=""
          class="size-5 object-contain"
        >
      </span>
      <KStepIcon
        v-else
        icon="i-lucide-box"
        :color="fw.color"
        :size="36"
        :radius="9"
      />
      <div class="min-w-0">
        <div class="flex items-center gap-1.5 text-[15px] font-medium leading-tight text-highlighted">
          <UIcon
            v-if="private"
            name="i-lucide-lock"
            class="size-3 flex-none text-dimmed"
          />
          <span class="truncate">{{ parts.name }}</span>
        </div>
        <div class="mt-1 truncate text-xs text-muted">
          {{ parts.org }} · {{ fwLabel }}
        </div>
      </div>
    </div>

    <div class="hidden min-w-0 flex-1 items-center gap-4 lg:flex">
      <KRunSparkline
        :stats="stats"
        class="h-7 max-w-52 flex-1"
      />
      <div class="w-20 flex-none text-right text-xs leading-snug text-muted tabular-nums">
        {{ stats?.total ?? 0 }} runs / 14d<br>
        {{ stats?.rate.value == null ? '–' : `${stats.rate.value}%` }} ok
      </div>
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

    <div class="hidden w-28 flex-none justify-start gap-1 xl:flex">
      <UTooltip
        v-for="t in integrations"
        :key="t.label"
        :text="t.label"
      >
        <span
          class="grid size-5.5 place-items-center rounded-[5px] bg-(--surface-accented)"
          :style="{ color: t.color }"
          :aria-label="t.label"
        >
          <UIcon
            :name="t.icon"
            class="size-3.25"
          />
        </span>
      </UTooltip>
    </div>

    <div class="flex w-24 flex-none justify-end">
      <KStatusBadge :meta="status" />
    </div>

    <UIcon
      name="i-lucide-chevron-right"
      class="size-4 flex-none text-dimmed"
    />
  </NuxtLink>
</template>
