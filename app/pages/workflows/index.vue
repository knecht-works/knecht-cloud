<script setup lang="ts">
const { data: workflows, refresh } = await useFetch('/api/workflows', { default: () => [] })
// Stats + automation columns stream in lazily: they don't gate the list.
const { data: runs } = useFetch('/api/runs', { default: () => [], lazy: true })
const { data: triggers } = useFetch('/api/triggers', { default: () => [], lazy: true })
const toastError = useToastError()

type WorkflowItem = NonNullable<typeof workflows.value>[number]

// Flip the workflow's automation master switch. Turning it ON publishes the
// current state first (the switch means "what the editor shows is what
// triggers run"), so an incomplete workflow refuses with the reason.
async function toggleEnabled(w: WorkflowItem) {
  try {
    if (!w.enabled) {
      await $fetch(`/api/workflows/${w.id}/publish`, { method: 'POST' })
    }
    await $fetch(`/api/workflows/${w.id}`, {
      method: 'PATCH',
      body: { enabled: !w.enabled },
    })
    await refresh()
  }
  catch (e) {
    toastError('Failed to update workflow', e)
  }
}

// Create the workflow right away and open it: the editor autosaves into the
// fresh row, so there is nothing to type before it exists.
const creating = ref(false)
async function createWorkflow() {
  creating.value = true
  try {
    const created = await $fetch('/api/workflows', { method: 'POST', body: {} })
    await navigateTo(`/workflows/${created.id}`)
  }
  catch (e) {
    toastError('Failed to create workflow', e)
  }
  finally {
    creating.value = false
  }
}

function fmt(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

// Each workflow enriched with run stats (rate, avg, status) plus its configured
// automation: the triggers it owns give both the projects it fires against and
// the trigger summary: no run needs to have happened yet.
const enriched = computed(() => (workflows.value ?? []).map((w) => {
  const wRuns = (runs.value ?? []).filter(r => r.workflowId === w.id)
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

  // Projects + trigger summary from the workflow's triggers (its automation).
  const wTriggers = (triggers.value ?? []).filter(t => t.workflowId === w.id)
  const names = [...new Set(wTriggers.flatMap(t => t.projects))]
  const projects = names.length > 3 ? [...names.slice(0, 2), `+${names.length - 2}`] : names
  const trigger = wTriggers.length === 0
    ? 'Manual'
    : wTriggers.length === 1
      ? triggerSourceMeta(wTriggers[0]!.source).label
      : `${wTriggers.length} triggers`

  return { ...w, rate, avg, status, statusText, projects, trigger, triggerCount: wTriggers.length }
}))

const metrics = computed(() => {
  const list = runs.value ?? []
  const completed = list.filter(r => r.status === 'success' || r.status === 'failed')
  const success = list.filter(r => r.status === 'success').length
  return {
    workflows: workflows.value?.length ?? 0,
    running: list.filter(r => isLiveStatus(r.status)).length,
    rate: completed.length ? Math.round((success / completed.length) * 100) : 0,
    runs: list.length,
  }
})

// ── import (YAML/JSON export files, or hand-written definitions) ────────────
const importInput = ref<HTMLInputElement>()
const importing = ref(false)
async function importFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (importInput.value) importInput.value.value = ''
  if (!file) return
  importing.value = true
  try {
    const source = await file.text()
    const created = await $fetch('/api/workflows/import', { method: 'POST', body: { source } })
    await navigateTo(`/workflows/${created.id}`)
  }
  catch (err) {
    toastError('Import failed', err)
  }
  finally {
    importing.value = false
  }
}

const tab = ref<'all' | 'used' | 'unused'>('all')
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'used', label: 'Automated' },
  { id: 'unused', label: 'Manual only' },
] as const

const filtered = computed(() =>
  enriched.value.filter(w =>
    tab.value === 'all' || (tab.value === 'used' ? w.triggerCount > 0 : w.triggerCount === 0),
  ),
)
</script>

<template>
  <div>
    <KTopBar title="Workflows">
      <template #actions>
        <AppSearch />
        <input
          ref="importInput"
          type="file"
          accept=".yaml,.yml,.json,application/yaml,application/json"
          class="hidden"
          @change="importFile"
        >
        <UButton
          icon="i-lucide-upload"
          label="Import"
          color="neutral"
          variant="ghost"
          :loading="importing"
          @click="importInput?.click()"
        />
        <UButton
          icon="i-lucide-plus"
          label="New workflow"
          color="primary"
          :loading="creating"
          @click="createWorkflow"
        />
      </template>
    </KTopBar>

    <div class="mb-5.5 grid grid-cols-2 gap-4 lg:grid-cols-4">
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
      <KFilterPills
        v-model="tab"
        :items="TABS.map(t => ({ value: t.id, label: t.label }))"
      />
    </div>

    <div
      v-if="!filtered.length"
      class="k-card flex flex-col items-center gap-3 px-6 py-14 text-center"
    >
      <UIcon
        name="i-lucide-workflow"
        class="size-7 text-dimmed"
      />
      <p class="text-2sm text-muted">
        {{ tab !== 'all' ? 'No workflows match.' : 'No workflows configured yet.' }}
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-3"
    >
      <WorkflowRow
        v-for="w in filtered"
        :id="w.id"
        :key="w.id"
        :name="w.name"
        :steps="w.draftSteps ?? w.steps"
        :status="w.status"
        :status-text="w.statusText"
        :trigger="w.trigger"
        :enabled="w.enabled"
        :rate="w.rate"
        :avg="w.avg"
        :projects="w.projects"
        @toggle="toggleEnabled(w)"
      />
    </div>
  </div>
</template>
