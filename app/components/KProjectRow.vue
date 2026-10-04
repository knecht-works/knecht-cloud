<script setup lang="ts">
import type { RunStatus } from '~/utils/dashboard'
import type { EnvState } from '#shared/utils/run'

interface RunSummary {
  status: RunStatus
  envState: EnvState
  workflow: string
  createdAt: string | number | Date | null
}

const props = defineProps<{
  id: number
  fullName: string
  defaultBranch: string
  private: boolean
  framework?: string | null
  frameworkVersion?: string | null
  favicon?: string | null
  latest?: RunSummary | null
  runsCount: number
}>()

const parts = computed(() => {
  const [org, ...rest] = props.fullName.split('/')
  return { org, name: rest.join('/') || org }
})

const fw = computed(() => frameworkMeta(props.framework))
const fwLabel = computed(() => props.frameworkVersion ? `${fw.value.label} ${props.frameworkVersion}` : fw.value.label)

const status = computed(() => props.latest ? RUN_STATUS_META[props.latest.status] : IDLE_STATUS_META)
const statusText = computed(() =>
  props.latest ? `${status.value.label} · ${props.latest.workflow}` : 'Ready · no runs yet',
)
</script>

<template>
  <NuxtLink
    :to="`/projects/${id}`"
    class="k-card k-lift flex items-center gap-5 overflow-hidden px-5 py-3.5"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <span
        v-if="favicon"
        class="grid size-[34px] flex-none place-items-center rounded-lg border border-default bg-(--surface-accented)"
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
        :size="34"
        :radius="8"
      />
      <div class="min-w-0">
        <div class="k-mono flex items-center gap-1.5 truncate text-sm font-medium leading-tight text-highlighted">
          <UIcon
            v-if="private"
            name="i-lucide-lock"
            class="size-3 flex-none text-dimmed"
          />
          <span class="truncate"><span class="text-dimmed">{{ parts.org }}/</span>{{ parts.name }}</span>
        </div>
        <div class="mt-1 flex items-center gap-1.5">
          <KStatusDot
            :color="status.dot"
            :pulse="status.pulse"
            :size="5"
          />
          <span
            class="k-mono truncate text-2xs"
            :style="{ color: status.text }"
          >{{ statusText }}</span>
        </div>
      </div>
    </div>

    <div
      class="k-mono hidden w-32 flex-none truncate text-2xs tracking-wide md:block"
      :style="{ color: fw.color }"
    >
      {{ fwLabel }}
    </div>

    <div class="hidden w-32 flex-none items-center gap-1.5 text-dimmed lg:flex">
      <UIcon
        name="i-lucide-git-branch"
        class="size-3.5 flex-none"
      />
      <span class="k-mono truncate text-2xs text-muted">{{ defaultBranch }}</span>
    </div>

    <div class="hidden w-20 flex-none items-center gap-1.5 text-dimmed sm:flex">
      <UIcon
        name="i-lucide-play"
        class="size-3.5 flex-none"
      />
      <span class="k-mono truncate text-2xs text-muted">{{ runsCount }} runs</span>
    </div>

    <div class="flex w-20 flex-none items-center gap-1.5 text-dimmed">
      <UIcon
        name="i-lucide-clock"
        class="size-3.5 flex-none"
      />
      <span class="k-mono truncate text-2xs text-muted">{{ latest ? timeAgo(latest.createdAt) : '–' }}</span>
    </div>

    <div class="flex w-12 flex-none items-center gap-1.5 text-primary">
      <template v-if="latest?.envState === 'up'">
        <UIcon
          name="i-lucide-globe"
          class="size-3.5"
        />
        <span class="k-mono text-2xs">Live</span>
      </template>
    </div>

    <UIcon
      name="i-lucide-chevron-right"
      class="size-4 flex-none text-dimmed"
    />
  </NuxtLink>
</template>
