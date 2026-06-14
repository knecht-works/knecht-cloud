<script setup lang="ts">
import type { RunStatusMeta, WorkflowStep } from '~/utils/dashboard'

const props = defineProps<{
  name: string
  steps: WorkflowStep[]
  status: RunStatusMeta
  statusText: string
  trigger?: string
  rate: number | null
  avg: string | null
  projects: string[]
}>()

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
    :to="`/workflows/${encodeURIComponent(name)}`"
    class="k-card k-lift flex items-center gap-5 overflow-hidden px-5 py-4"
  >
    <!-- identity -->
    <div class="flex w-56 min-w-0 flex-none items-center gap-3">
      <KStepIcon
        icon="i-lucide-workflow"
        color="var(--text-primary)"
        :size="38"
        :radius="9"
      />
      <div class="min-w-0">
        <div class="truncate text-[14.5px] font-medium text-(--text-highlighted)">
          {{ name }}
        </div>
        <div class="mt-1 flex items-center gap-1.5">
          <KStatusDot
            :color="status.dot"
            :pulse="status.pulse"
            :size="5"
          />
          <span
            class="k-mono truncate text-[11px]"
            :style="{ color: status.text }"
          >{{ statusText }}</span>
        </div>
      </div>
    </div>

    <!-- trigger -->
    <div class="hidden w-[120px] flex-none items-center gap-2 lg:flex">
      <UIcon
        name="i-lucide-play"
        class="size-[15px] flex-none text-(--text-dimmed)"
      />
      <div class="min-w-0">
        <div class="k-label">
          Trigger
        </div>
        <span class="text-[12.5px] text-(--text-toned)">{{ trigger ?? 'Manual' }}</span>
      </div>
    </div>

    <!-- step sequence -->
    <div class="hidden min-w-0 flex-1 items-center overflow-hidden md:flex">
      <template
        v-for="(s, i) in stepMetas"
        :key="i"
      >
        <span
          class="grid size-7 flex-none place-items-center rounded-[7px] border border-(--border-default) bg-(--surface-accented)"
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

    <!-- metrics -->
    <div class="ml-auto flex flex-none items-center gap-5 lg:ml-6">
      <div class="w-[58px] flex-none text-right">
        <div
          class="k-mono text-[17px] font-bold"
          :style="{ color: rateColor }"
        >
          {{ rate === null ? '–' : `${rate}%` }}
        </div>
        <div class="k-label !text-[10px]">
          Success
        </div>
      </div>
      <div class="hidden w-[58px] flex-none text-right sm:block">
        <div class="k-mono text-[15px] text-(--text-toned)">
          {{ avg ?? '–' }}
        </div>
        <div class="k-label !text-[10px]">
          Avg run
        </div>
      </div>
      <div class="hidden w-[150px] flex-none flex-wrap justify-end gap-1.5 xl:flex">
        <span
          v-for="p in projects"
          :key="p"
          class="k-mono whitespace-nowrap rounded-[5px] border border-(--border-muted) bg-(--surface-base) px-2 py-1 text-[10.5px] text-(--text-muted)"
        >{{ p }}</span>
      </div>
    </div>

    <UIcon
      name="i-lucide-chevron-right"
      class="size-4 flex-none text-(--text-dimmed)"
    />
  </NuxtLink>
</template>
