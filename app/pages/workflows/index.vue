<script setup lang="ts">
const { data: workflows } = await useFetch('/api/workflows', { default: () => [] })
const { data: runs } = await useFetch('/api/runs', { default: () => [] })

function fmt(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

// Each workflow enriched with stats derived from its runs (rate, avg, status,
// attached projects). Triggers aren't wired yet, so every run is "Manual".
const enriched = computed(() => (workflows.value ?? []).map((w) => {
  const wRuns = (runs.value ?? []).filter(r => r.workflow === w.name)
  const completed = wRuns.filter(r => r.status === 'success' || r.status === 'failed')
  const successCount = wRuns.filter(r => r.status === 'success').length
  const rate = completed.length ? Math.round((successCount / completed.length) * 100) : null

  const durations = wRuns
    .filter(r => r.status === 'success' && r.startedAt && r.finishedAt)
    .map(r => (new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime()) / 1000)
    .filter(n => Number.isFinite(n) && n >= 0)
  const avg = durations.length ? fmt(durations.reduce((a, b) => a + b, 0) / durations.length) : null

  const latest = wRuns[0] ?? null
  const status = latest ? RUN_STATUS_META[latest.status] : IDLE_STATUS_META
  const statusText = latest ? `${status.label} · ${timeAgo(latest.createdAt)}` : 'No runs yet'

  const names = [...new Set(wRuns.map(r => r.project.split('/').pop()!))]
  const projects = names.length > 3 ? [...names.slice(0, 2), `+${names.length - 2}`] : names

  return { ...w, rate, avg, status, statusText, projects, runsCount: wRuns.length }
}))

const metrics = computed(() => {
  const list = runs.value ?? []
  const completed = list.filter(r => r.status === 'success' || r.status === 'failed')
  const success = list.filter(r => r.status === 'success').length
  return {
    workflows: workflows.value?.length ?? 0,
    running: list.filter(r => r.status === 'running' || r.status === 'queued').length,
    rate: completed.length ? Math.round((success / completed.length) * 100) : 0,
    runs: list.length,
  }
})

const tab = ref<'all' | 'used' | 'unused'>('all')
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'used', label: 'Active' },
  { id: 'unused', label: 'Unused' },
] as const

const filtered = computed(() =>
  enriched.value.filter(w =>
    tab.value === 'all' || (tab.value === 'used' ? w.runsCount > 0 : w.runsCount === 0),
  ),
)
</script>

<template>
  <div>
    <KTopBar title="Workflows">
      <template #actions>
        <AppSearch />
        <UButton
          icon="i-lucide-plus"
          label="New workflow"
          color="neutral"
          @click="navigateTo('/workflows/new')"
        />
      </template>
    </KTopBar>

    <div class="mb-[22px] grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KMetric
        :value="metrics.workflows"
        label="Workflows"
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
        :value="metrics.runs"
        label="Total runs"
      />
    </div>

    <div class="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <span class="k-label">All workflows</span>
      <div class="flex gap-2">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          class="k-mono rounded-full px-2.5 py-1 text-[11.5px] transition-colors"
          :class="tab === t.id
            ? 'border border-(--border-default) bg-(--surface-glass) text-(--text-muted)'
            : 'border border-transparent text-(--text-dimmed) hover:text-(--text-muted)'"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>
    </div>

    <div
      v-if="!filtered.length"
      class="k-card flex flex-col items-center gap-3 px-6 py-14 text-center"
    >
      <UIcon
        name="i-lucide-workflow"
        class="size-7 text-(--text-dimmed)"
      />
      <p class="text-[13px] text-(--text-muted)">
        {{ tab !== 'all' ? 'No workflows match.' : 'No workflows configured yet.' }}
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-3"
    >
      <WorkflowRow
        v-for="w in filtered"
        :key="w.name"
        :name="w.name"
        :steps="w.steps"
        :status="w.status"
        :status-text="w.statusText"
        :rate="w.rate"
        :avg="w.avg"
        :projects="w.projects"
      />
    </div>
  </div>
</template>
