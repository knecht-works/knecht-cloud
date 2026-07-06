<script setup lang="ts">
// Global run history: every execution across all projects, newest first.
// A run drills into /runs/:id; the list itself polls while anything is live.
const { data: runs, refresh } = await useFetch('/api/runs', { default: () => [] })

const anyLive = computed(() => (runs.value ?? []).some(r => isLiveStatus(r.status)))
usePollWhile(() => anyLive.value, refresh)

const metrics = computed(() => {
  const list = runs.value ?? []
  const completed = list.filter(r => r.status === 'success' || r.status === 'failed')
  const success = list.filter(r => r.status === 'success').length
  return {
    total: list.length,
    running: list.filter(r => isLiveStatus(r.status)).length,
    rate: completed.length ? Math.round((success / completed.length) * 100) : 0,
    automated: list.filter(r => r.triggerId !== null).length,
  }
})

// How the run started: a configured trigger's source, else a manual start.
function origin(r: NonNullable<typeof runs.value>[number]) {
  return triggerSourceMeta(r.trigger ?? 'manual')
}
</script>

<template>
  <div>
    <KTopBar title="Runs">
      <template #actions>
        <AppSearch />
      </template>
    </KTopBar>

    <div class="mb-[22px] grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KMetric
        :value="metrics.total"
        label="Runs"
      />
      <KMetric
        :value="metrics.running"
        label="Running now"
        accent="var(--accent-orange)"
      />
      <KMetric
        :value="metrics.rate"
        suffix="%"
        label="Avg success rate"
        accent="var(--primary)"
      />
      <KMetric
        :value="metrics.automated"
        label="Automated"
      />
    </div>

    <!-- Empty state: no runs yet -->
    <div
      v-if="!runs.length"
      class="k-card flex flex-col items-center gap-4 px-6 py-16 text-center"
    >
      <img
        src="/mascot/mascotRight.png"
        alt="Knecht"
        class="h-20 w-auto"
        style="filter: var(--drop-shadow-mascot)"
      >
      <div>
        <div class="text-sm font-medium text-(--text-toned)">
          No runs yet
        </div>
        <p class="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-[1.5] text-(--text-muted)">
          A run is one execution of a workflow against a project. Start a workflow from a
          project, a workflow, or a trigger, and it shows up here.
        </p>
      </div>
    </div>

    <!-- Run list -->
    <div
      v-else
      class="k-card overflow-hidden"
    >
      <NuxtLink
        v-for="(r, i) in runs"
        :key="r.id"
        :to="`/runs/${r.id}`"
        class="flex items-center gap-3 px-[18px] py-3 transition-colors hover:bg-(--surface-glass)"
        :class="i ? 'border-t border-(--border-muted)' : ''"
      >
        <KStatusDot
          :color="RUN_STATUS_META[r.status].dot"
          :pulse="RUN_STATUS_META[r.status].pulse"
          :size="6"
        />
        <span class="k-mono truncate text-[12.5px] text-(--text-default)">{{ r.workflow }}</span>
        <span class="k-mono text-[11px] text-(--text-dimmed)">#{{ r.id }}</span>
        <span class="k-mono hidden min-w-0 truncate text-[11px] text-(--text-muted) md:block">{{ r.project }}</span>

        <UTooltip
          :text="origin(r).label"
          class="ml-auto flex-none"
        >
          <UIcon
            :name="origin(r).icon"
            class="size-[13px]"
            :style="{ color: origin(r).color }"
          />
        </UTooltip>
        <span
          class="k-mono w-16 flex-none text-right text-[11px]"
          :style="{ color: RUN_STATUS_META[r.status].text }"
        >{{ RUN_STATUS_META[r.status].label }}</span>
        <span class="k-mono w-14 flex-none text-right text-[11px] text-(--text-dimmed)">{{ runDuration(r.startedAt, r.finishedAt) }}</span>
        <span class="k-mono hidden w-16 flex-none text-right text-[11px] text-(--text-dimmed) sm:block">{{ timeAgo(r.createdAt) }}</span>
        <UIcon
          name="i-lucide-chevron-right"
          class="size-4 flex-none text-(--text-dimmed)"
        />
      </NuxtLink>
    </div>
  </div>
</template>
