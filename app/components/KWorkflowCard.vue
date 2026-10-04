<script setup lang="ts">
import type { RunStatusMeta, WorkflowStep } from '~/utils/dashboard'

const props = defineProps<{
  id: number
  name: string
  steps: WorkflowStep[]
  status: RunStatusMeta
  statusText: string
  trigger?: string
  enabled: boolean
  rate: number | null
  avg: string | null
  projects: string[]
}>()

const emit = defineEmits<{ toggle: [] }>()

const stepMetas = computed(() => props.steps.map(workflowStepMeta))
const rateColor = computed(() => {
  if (props.rate === null) return 'var(--text-dimmed)'
  if (props.rate >= 90) return 'var(--primary)'
  if (props.rate >= 80) return 'var(--accent-orange)'
  return 'var(--status-error)'
})
</script>

<template>
  <NuxtLink
    :to="`/workflows/${id}`"
    class="k-card k-lift flex h-full min-h-45 flex-col overflow-hidden"
    :style="{ opacity: enabled ? 1 : 0.6 }"
  >
    <div class="flex items-start gap-3 px-5 pb-3.5 pt-4.5">
      <KStepIcon
        icon="i-lucide-workflow"
        color="var(--text-primary)"
        :size="34"
        :radius="8"
      />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium leading-tight text-highlighted">
          {{ name }}
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
      <UTooltip :text="enabled ? 'Automation on, click to pause' : 'Automation paused, click to enable'">
        <KToggle
          :active="enabled"
          :aria-label="enabled ? 'Pause automation' : 'Enable automation'"
          style="opacity: 1"
          @toggle="emit('toggle')"
        />
      </UTooltip>
    </div>

    <div class="flex min-w-0 items-center overflow-hidden px-5 pb-3.5">
      <template
        v-for="(s, i) in stepMetas"
        :key="i"
      >
        <span
          class="grid size-7 flex-none place-items-center rounded-lg border border-default bg-(--surface-accented)"
          :style="{ color: STEP_KIND_COLOR[s.kind] }"
        >
          <UIcon
            :name="s.icon"
            class="size-3.5"
          />
        </span>
        <span
          v-if="i < stepMetas.length - 1"
          class="h-px w-2.5 flex-none bg-(--border-accented)"
        />
      </template>
    </div>

    <div
      v-if="projects.length"
      class="flex flex-wrap gap-1.5 px-5 pb-3.5"
    >
      <span
        v-for="p in projects"
        :key="p"
        class="k-code whitespace-nowrap text-2xs"
      >{{ p }}</span>
    </div>

    <div class="mt-auto flex border-t border-muted">
      <div class="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-3 text-dimmed">
        <UIcon
          name="i-lucide-play"
          class="size-3.5 flex-none"
        />
        <span class="k-mono truncate text-2xs text-muted">{{ trigger ?? 'Manual' }}</span>
      </div>
      <div class="flex flex-1 items-center gap-1.5 border-l border-muted px-3 py-3 text-dimmed">
        <UIcon
          name="i-lucide-circle-check"
          class="size-3.5 flex-none"
        />
        <span
          class="k-mono truncate text-2xs"
          :style="{ color: rateColor }"
        >{{ rate === null ? '–' : `${rate}%` }}</span>
      </div>
      <div class="flex flex-1 items-center gap-1.5 border-l border-muted px-3 py-3 text-dimmed">
        <UIcon
          name="i-lucide-clock"
          class="size-3.5 flex-none"
        />
        <span class="k-mono truncate text-2xs text-muted">{{ avg ?? '–' }}</span>
      </div>
    </div>
  </NuxtLink>
</template>
