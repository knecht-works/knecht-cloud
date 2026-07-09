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
    class="k-card k-lift flex h-full flex-col overflow-hidden"
  >
    <div class="px-5 pb-4 pt-4.5">
      <div class="flex items-start gap-2.5">
        <div class="flex min-w-0 items-center gap-3">
          <KStepIcon
            icon="i-lucide-box"
            :color="fw.color"
            :size="34"
            :radius="8"
          />
          <div class="min-w-0">
            <div class="k-mono flex items-center gap-1.5 truncate text-xs leading-tight text-default">
              <UIcon
                v-if="private"
                name="i-lucide-lock"
                class="size-3 flex-none text-dimmed"
              />
              <span class="truncate"><span class="text-dimmed">{{ parts.org }}/</span>{{ parts.name }}</span>
            </div>
            <div
              class="k-mono mt-1 text-2xs tracking-wide"
              :style="{ color: fw.color }"
            >
              {{ fwLabel }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2 px-5 pb-3.5">
      <KStatusDot
        :color="status.dot"
        :pulse="status.pulse"
        :size="6"
      />
      <span
        class="k-mono text-2xs tracking-wider"
        :style="{ color: status.text }"
      >{{ statusText }}</span>
    </div>

    <div class="mt-auto flex border-t border-muted">
      <div class="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-3 text-dimmed">
        <UIcon
          name="i-lucide-git-branch"
          class="size-3.5 flex-none"
        />
        <span class="k-mono truncate text-2xs text-muted">{{ defaultBranch }}</span>
      </div>
      <div class="flex flex-1 items-center gap-1.5 border-l border-muted px-3 py-3 text-dimmed">
        <UIcon
          name="i-lucide-play"
          class="size-3.5 flex-none"
        />
        <span class="k-mono truncate text-2xs text-muted">{{ runsCount }} runs</span>
      </div>
      <div class="flex flex-1 items-center gap-1.5 border-l border-muted px-3 py-3 text-dimmed">
        <UIcon
          name="i-lucide-clock"
          class="size-3.5 flex-none"
        />
        <span class="k-mono truncate text-2xs text-muted">{{ latest ? timeAgo(latest.createdAt) : '–' }}</span>
      </div>
      <div
        v-if="latest?.envState === 'up'"
        class="flex items-center gap-1.5 border-l border-muted px-3.5 py-3 text-primary"
      >
        <UIcon
          name="i-lucide-globe"
          class="size-3.5"
        />
        <span class="k-mono text-2xs">Live</span>
      </div>
    </div>
  </NuxtLink>
</template>
