<script setup lang="ts">
import { liveTopics } from '#shared/utils/live-topics'
import { KWorkflowCard, KWorkflowRow } from '#components'
import { computeRunStats } from '#shared/utils/run-stats'
import { matchesFilters, parseFilters, serializeFilters, type FilterFields } from '#shared/utils/filter'

const { data: workflows } = await useWorkflows()
const { data: runs } = useRuns()
const { data: triggers } = useTriggers()
const { data: statsRuns } = useRunStats()

// Stats bucket by the viewer's local days, which the server can't know, so they wait for hydration.
const hydrated = ref(false)
onMounted(() => {
  hydrated.value = true
})

const runsLast14d = computed(() => {
  if (!hydrated.value) return new Map<number, number>()
  const grouped = new Map<number, NonNullable<typeof statsRuns.value>>()
  for (const r of statsRuns.value ?? []) {
    if (r.workflowId !== null) grouped.set(r.workflowId, [...(grouped.get(r.workflowId) ?? []), r])
  }
  const now = new Date()
  return new Map([...grouped].map(([id, list]) => [id, computeRunStats(list, now).total]))
})
const toastError = useToastError()

type WorkflowItem = NonNullable<typeof workflows.value>[number]

async function toggleEnabled(w: WorkflowItem) {
  try {
    await $fetch(`/api/workflows/${w.id}`, {
      method: 'PATCH',
      body: { enabled: !w.enabled },
    })
    await invalidate(liveTopics.workflows)
  }
  catch (e) {
    toastError('Failed to update workflow', e)
  }
}

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

const enriched = computed(() => (workflows.value ?? []).map((w) => {
  const wRuns = (runs.value ?? []).filter(r => r.workflowId === w.id)
  const completed = wRuns.filter(r => r.status === 'success' || r.status === 'failed')
  const successCount = wRuns.filter(r => r.status === 'success').length
  const rate = completed.length ? Math.round((successCount / completed.length) * 100) : null

  const durations = wRuns
    .filter(r => r.status === 'success' && r.startedAt && r.finishedAt)
    .map(r => (new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime()) / 1000)
    .filter(n => Number.isFinite(n) && n >= 0)
  const avg = durations.length ? formatDuration(durations.reduce((a, b) => a + b, 0) / durations.length) : null

  const latest = wRuns[0] ?? null
  const status = runStatusMeta(latest)
  const statusText = latest ? `${status.label} · ${timeAgo(latest.createdAt)}` : 'No runs yet'

  const wTriggers = (triggers.value ?? []).filter(t => t.workflowId === w.id)
  const names = [...new Set(wTriggers.flatMap(t => t.projects))]
  const projects = names.length > 3 ? [...names.slice(0, 2), `+${names.length - 2}`] : names
  const trigger = wTriggers.length === 0
    ? 'Manual'
    : wTriggers.length === 1
      ? triggerMeta(wTriggers[0]!).label
      : `${wTriggers.length} triggers`

  const facts = {
    trigger: wTriggers.length ? wTriggers.map(t => triggerMeta(t).label) : ['Manual'],
    project: names,
    automation: w.enabled ? 'On' : 'Paused',
    status: status.label,
  }

  return { ...w, rate, avg, status, statusText, projects, trigger, latest, facts }
}))

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

const FILTER_FIELDS: FilterFields = {
  trigger: { label: 'Trigger', ops: ['is', 'is not'] },
  project: { label: 'Project', ops: ['is', 'is not'] },
  automation: { label: 'Automation', ops: ['is'] },
  status: { label: 'Last run', ops: ['is', 'is not'] },
}

function uniqueOptions(values: string[]) {
  return [...new Set(values)].sort().map(value => ({ value, label: value }))
}

const filterOptions = computed(() => ({
  trigger: uniqueOptions(enriched.value.flatMap(w => w.facts.trigger)),
  project: uniqueOptions(enriched.value.flatMap(w => w.facts.project)),
  automation: [{ value: 'On', label: 'On' }, { value: 'Paused', label: 'Paused' }],
  status: uniqueOptions(enriched.value.map(w => w.facts.status)),
}))

const filters = useQueryPreference('filter', {
  cookie: 'knecht-workflows-filters',
  default: () => [],
  parse: value => value == null ? null : parseFilters(value, FILTER_FIELDS),
  serialize: serializeFilters,
})

type SortKey = 'created' | 'activity' | 'attention' | 'runs' | 'name'

const SORT_OPTIONS: { value: SortKey, label: string }[] = [
  { value: 'created', label: 'Date created' },
  { value: 'activity', label: 'Last activity' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'runs', label: 'Most runs (14d)' },
  { value: 'name', label: 'Name' },
]

const sort = useQueryPreference('sort', {
  cookie: 'knecht-workflows-sort',
  default: (): SortKey => 'created',
  parse: oneOf(SORT_OPTIONS.map(o => o.value)),
  serialize: value => value,
})

const view = useQueryPreference('view', {
  cookie: 'knecht-workflows-view',
  default: (): 'grid' | 'list' => 'list',
  parse: oneOf(['grid', 'list'] as const),
  serialize: value => value,
})

function time(value: string | number | Date | null | undefined) {
  return value ? new Date(value).getTime() : 0
}

function attentionRank(w: (typeof enriched.value)[number]) {
  if (w.latest?.status === 'failed') return 0
  if (w.latest && (isLiveStatus(w.latest.status) || w.latest.envTransition)) return 1
  return 2
}

const filtered = computed(() => {
  const list = enriched.value.filter(w => matchesFilters(w.facts, filters.value))
  const byActivity = (a: (typeof list)[number], b: (typeof list)[number]) => time(b.latest?.createdAt) - time(a.latest?.createdAt)
  const compare: Record<SortKey, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
    created: (a, b) => time(b.createdAt) - time(a.createdAt),
    activity: byActivity,
    attention: (a, b) => attentionRank(a) - attentionRank(b) || byActivity(a, b),
    runs: (a, b) => (runsLast14d.value.get(b.id) ?? 0) - (runsLast14d.value.get(a.id) ?? 0) || byActivity(a, b),
    name: (a, b) => a.name.localeCompare(b.name),
  }
  return list.toSorted(compare[sort.value])
})
</script>

<template>
  <div>
    <KTopBar title="Workflows">
      <template #actions>
        <input
          ref="importInput"
          type="file"
          accept=".yaml,.yml,.json,application/yaml,application/json"
          class="hidden"
          @change="importFile"
        >
        <UTooltip text="Import a workflow from a YAML or JSON file">
          <UButton
            size="lg"
            label="Import"
            color="neutral"
            variant="outline"
            :loading="importing"
            @click="importInput?.click()"
          />
        </UTooltip>
        <UTooltip text="Create an empty workflow">
          <UButton
            size="lg"
            label="New workflow"
            color="primary"
            :loading="creating"
            @click="createWorkflow"
          />
        </UTooltip>
      </template>
    </KTopBar>

    <div class="mb-4.5 flex items-start gap-2">
      <USelect
        v-model="sort"
        :items="SORT_OPTIONS"
        color="neutral"
        variant="outline"
        aria-label="Sort workflows"
        size="sm"
        class="w-40"
      />
      <KFilterBuilder
        v-model="filters"
        :fields="FILTER_FIELDS"
        :options="filterOptions"
      />
      <KFilterChips
        v-model="filters"
        :fields="FILTER_FIELDS"
        :options="filterOptions"
        class="min-h-8 min-w-0 flex-1"
      />
      <KViewToggle v-model="view" />
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
        {{ enriched.length ? 'No workflows match.' : 'No workflows configured yet.' }}
      </p>
    </div>

    <div
      v-else
      :class="view === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-3'"
    >
      <component
        :is="view === 'grid' ? KWorkflowCard : KWorkflowRow"
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
