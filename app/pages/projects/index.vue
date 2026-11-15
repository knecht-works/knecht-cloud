<script setup lang="ts">
import { liveTopics } from '#shared/utils/live-topics'
import { matchesFilters, uniqueOptions, type FilterFields } from '#shared/utils/filter'
import { TRACKER_IDS } from '#shared/utils/integrations'

const { data: projects } = await useProjects()
const { data: runs } = useRuns()

const runsByProject = computed(() => {
  const latest = new Map<number, (typeof runs.value)[number]>()
  for (const r of runs.value ?? []) {
    if (!latest.has(r.projectId)) latest.set(r.projectId, r)
  }
  return { latest }
})

const { data: activity } = useProjectActivity()

const statsByProject = useRunStatsBy('projectId')

const activityByProject = computed(() => new Map((activity.value ?? []).map(a => [a.projectId, a])))

const FILTER_FIELDS: FilterFields = {
  stack: { label: 'Stack', ops: ['is', 'is not'] },
  version: { label: 'Version', ops: ['=', '<', '>'], input: 'version' },
  state: { label: 'State', ops: ['is', 'is not'] },
  tracker: { label: 'Linked tracker', ops: ['is'] },
}

function facts(p: NonNullable<typeof projects.value>[number]) {
  return {
    stack: frameworkMeta(p.framework).label,
    version: p.frameworkVersion,
    state: projectStatusMeta(runsByProject.value.latest.get(p.id)).label,
    tracker: Object.keys(p.links ?? {}),
  }
}

const filterOptions = computed(() => {
  const all = (projects.value ?? []).map(facts)
  return {
    stack: uniqueOptions(all.map(f => f.stack)),
    state: uniqueOptions(all.map(f => f.state)),
    tracker: TRACKER_IDS.map(id => ({ value: id, label: integrationUi(id).label })),
  }
})

const filters = useFilterPreference('knecht-projects-filters', FILTER_FIELDS)

type SortKey = 'created' | 'activity' | 'attention' | 'runs' | 'name'

const SORT_OPTIONS: { value: SortKey, label: string }[] = [
  { value: 'created', label: 'Date created' },
  { value: 'activity', label: 'Last activity' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'runs', label: 'Most runs (14d)' },
  { value: 'name', label: 'Name' },
]

const sort = useQueryPreference('sort', {
  cookie: 'knecht-projects-sort',
  default: (): SortKey => 'created',
  parse: oneOf(SORT_OPTIONS.map(o => o.value)),
  serialize: value => value,
})

function lastActivity(id: number) {
  const at = runsByProject.value.latest.get(id)?.createdAt
  return at ? new Date(at).getTime() : 0
}

function attentionRank(id: number) {
  const run = runsByProject.value.latest.get(id)
  if (run?.status === 'failed') return 0
  if (run && (isLiveStatus(run.status) || run.envTransition)) return 1
  if (activityByProject.value.get(id)?.live) return 2
  return 3
}

const filtered = computed(() => {
  const list = (projects.value ?? []).filter(p => matchesFilters(facts(p), filters.value))
  const byActivity = (a: { id: number }, b: { id: number }) => lastActivity(b.id) - lastActivity(a.id)
  const compare: Record<SortKey, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
    created: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    activity: byActivity,
    attention: (a, b) => attentionRank(a.id) - attentionRank(b.id) || byActivity(a, b),
    runs: (a, b) => (statsByProject.value.get(b.id)?.total ?? 0) - (statsByProject.value.get(a.id)?.total ?? 0) || byActivity(a, b),
    name: (a, b) => a.name.localeCompare(b.name),
  }
  return list.toSorted(compare[sort.value] ?? byActivity)
})

const view = useQueryPreference('view', {
  cookie: 'knecht-projects-view',
  default: (): 'grid' | 'list' => 'grid',
  parse: oneOf(['grid', 'list'] as const),
  serialize: value => value,
})

const open = ref(false)
</script>

<template>
  <div>
    <KTopBar title="Projects">
      <template #actions>
        <UTooltip text="Connect a GitHub repo">
          <UButton
            size="lg"
            label="New project"
            color="primary"
            @click="() => { open = true }"
          />
        </UTooltip>
      </template>
    </KTopBar>

    <KListToolbar
      v-model:sort="sort"
      v-model:filters="filters"
      v-model:view="view"
      :sort-options="SORT_OPTIONS"
      :fields="FILTER_FIELDS"
      :options="filterOptions"
      class="mb-4.5"
    />

    <div
      v-if="view === 'list'"
      class="flex flex-col gap-3"
    >
      <KProjectRow
        v-for="p in filtered"
        :id="p.id"
        :key="p.id"
        :full-name="p.fullName"
        :private="p.private"
        :framework="p.framework"
        :framework-version="p.frameworkVersion"
        :favicon="p.favicon"
        :latest="runsByProject.latest.get(p.id) ?? null"
        :stats="statsByProject.get(p.id) ?? null"
        :activity="activityByProject.get(p.id) ?? null"
        :links="p.links"
        :repo-provider="p.repoProvider"
      />

      <button
        type="button"
        class="k-dashed group flex items-center gap-3 rounded-lg bg-(--surface-muted) px-5 py-3.5 text-left cursor-pointer"
        @click="open = true"
      >
        <span class="grid size-[34px] place-items-center rounded-lg border border-accented bg-(--surface-muted) text-primary transition-colors group-hover:bg-(--surface-accented)">
          <UIcon
            name="i-lucide-plus"
            class="size-4"
          />
        </span>
        <div>
          <div class="text-sm font-medium text-toned">
            Connect a new project
          </div>
          <div class="mt-0.5 text-xs text-dimmed">
            A GitHub repo with DDEV
          </div>
        </div>
      </button>
    </div>

    <div
      v-else
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
    >
      <KProjectCard
        v-for="p in filtered"
        :id="p.id"
        :key="p.id"
        :full-name="p.fullName"
        :private="p.private"
        :framework="p.framework"
        :framework-version="p.frameworkVersion"
        :favicon="p.favicon"
        :latest="runsByProject.latest.get(p.id) ?? null"
        :stats="statsByProject.get(p.id) ?? null"
        :activity="activityByProject.get(p.id) ?? null"
        :links="p.links"
        :repo-provider="p.repoProvider"
      />

      <button
        type="button"
        class="k-dashed group flex h-full flex-col items-center justify-center gap-3.5 rounded-lg bg-(--surface-muted) p-6 text-center cursor-pointer"
        @click="open = true"
      >
        <span class="grid size-12 place-items-center rounded-xl border border-accented bg-(--surface-muted) text-primary transition-colors group-hover:bg-(--surface-accented)">
          <UIcon
            name="i-lucide-plus"
            class="size-6"
          />
        </span>
        <div>
          <div class="text-sm font-medium text-toned">
            Connect a new project
          </div>
          <div class="mx-auto mt-1 max-w-50 text-xs text-dimmed">
            A GitHub repo with DDEV
          </div>
        </div>
      </button>
    </div>

    <KProjectSetupModal
      v-model:open="open"
      @created="invalidate(liveTopics.projects)"
    />
  </div>
</template>
