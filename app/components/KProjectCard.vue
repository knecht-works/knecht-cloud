<script setup lang="ts">
import type { RunStatus, RunStatusMeta } from '~/utils/dashboard'
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

const ENV_META: Record<EnvState, RunStatusMeta> = {
  up: { dot: 'primary', pulse: false, text: 'var(--text-primary)', label: 'Up' },
  stopped: { dot: 'neutral', pulse: false, text: 'var(--text-muted)', label: 'Stopped' },
  archived: { dot: 'neutral', pulse: false, text: 'var(--text-muted)', label: 'Archived' },
  down: { dot: 'neutral', pulse: false, text: 'var(--text-muted)', label: 'Idle' },
}

const status = computed<RunStatusMeta>(() => {
  const run = props.latest
  if (!run || run.envTransition || isLiveStatus(run.status) || run.status === 'failed') return runStatusMeta(run)
  if (run.envState === 'up' && run.previewReady) return { ...ENV_META.up, label: 'Live' }
  if (run.envState === 'down' && run.sessionStatus === 'closed') return { ...ENV_META.down, label: 'Closed' }
  return ENV_META[run.envState]
})

const daily = computed(() => props.stats?.days.map(d => d.success + d.failed) ?? Array.from({ length: 14 }, () => 0))

const sparkPoints = computed(() => {
  const max = Math.max(...daily.value) || 1
  const step = 100 / (daily.value.length - 1)
  return daily.value.map((v, i) => `${i * step},${34 - (v / max) * 32}`).join(' ')
})

const integrations = computed(() =>
  [props.repoProvider, ...Object.keys(props.links ?? {}) as IntegrationId[]].map(integrationUi),
)
</script>

<template>
  <NuxtLink
    :to="`/projects/${id}`"
    class="k-card k-lift flex h-full flex-col gap-3.5 px-4.5 pb-3.5 pt-4.5"
  >
    <div class="flex items-start gap-3">
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
      <div class="min-w-0 flex-1">
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
      <span
        class="flex flex-none items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
        :style="{ color: status.text, background: `color-mix(in srgb, ${DOT_COLOR_VAR[status.dot]} 12%, transparent)` }"
      >
        <KStatusDot
          :color="status.dot"
          :pulse="status.pulse"
          :glow="false"
        />
        {{ status.label }}
      </span>
    </div>

    <div class="mt-auto flex items-end gap-3 pt-4">
      <svg
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
        class="h-9 w-44 min-w-0"
        :class="(stats?.rate.value ?? 100) < 80 ? 'text-error' : 'text-primary'"
        aria-hidden="true"
      >
        <polyline
          :points="sparkPoints"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <div class="ml-auto flex-none text-right text-xs leading-snug text-muted tabular-nums">
        {{ stats?.total ?? 0 }} runs / 14d<br>
        {{ stats?.rate.value == null ? '–' : `${stats.rate.value}%` }} ok
      </div>
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
      <span class="ml-auto flex gap-1">
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
      </span>
    </div>
  </NuxtLink>
</template>
