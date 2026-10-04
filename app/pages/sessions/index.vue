<script setup lang="ts">
import { runWorkspacePath } from '#shared/utils/routes'
import { computeRunStats } from '#shared/utils/run-stats'

const { data: runs, refresh } = await useFetch('/api/runs', { default: () => [] })

const anyLive = computed(() => (runs.value ?? []).some(r => isLiveStatus(r.status)))
usePollWhile(() => anyLive.value, refresh)

const { data: statsRuns } = useFetch('/api/runs/stats', { default: () => [], lazy: true, watch: [runs] })
const stats = computed(() => computeRunStats(statsRuns.value ?? [], new Date()))

function deltaColor(delta: number, higherIsBetter: boolean) {
  return (delta > 0) === higherIsBetter ? 'var(--primary)' : 'var(--status-error)'
}

const rateDelta = computed(() => {
  const d = stats.value.rate.delta
  return d ? { text: `${d > 0 ? '+' : ''}${d}`, color: deltaColor(d, true) } : null
})

const durationDelta = computed(() => {
  const d = stats.value.duration.delta
  return d ? { text: `${d > 0 ? '+' : '-'}${formatDuration(Math.abs(d))}`, color: deltaColor(d, false) } : null
})

const DONUT_CORNER = 1.25

// A filled ring segment shrunk by the corner radius, then stroked with round joins,
// gives the arc small rounded corners (stroke-linecap only offers fully round ends).
function donutArc(percent: number) {
  const outer = 16.5 - DONUT_CORNER
  const inner = 11.5 + DONUT_CORNER
  const inset = DONUT_CORNER / 14
  const start = -Math.PI / 2 + inset
  const end = Math.max(start + 0.001, -Math.PI / 2 + (percent / 100) * 2 * Math.PI - inset)
  const large = end - start > Math.PI ? 1 : 0
  const at = (r: number, a: number) => `${18 + r * Math.cos(a)},${18 + r * Math.sin(a)}`
  return `M${at(outer, start)} A${outer},${outer} 0 ${large} 1 ${at(outer, end)} L${at(inner, end)} A${inner},${inner} 0 ${large} 0 ${at(inner, start)} Z`
}

const sessionGroups = computed(() => groupRunsBySession(runs.value ?? []))
</script>

<template>
  <div>
    <KTopBar title="Sessions" />

    <div class="@container relative mb-5.5">
      <span class="k-mono absolute bottom-full right-0 mb-2 text-2xs text-dimmed">
        Last 14 days
      </span>
      <div class="grid grid-cols-1 gap-4 @xl:grid-cols-2 @5xl:grid-cols-4">
        <KMetric
          :value="String(stats.total)"
          label="Runs"
        >
          <KMiniBars :days="stats.days" />
        </KMetric>
        <KMetric
          :value="stats.rate.value === null ? '–' : `${stats.rate.value}%`"
          label="Success rate"
          :delta="rateDelta?.text"
          :delta-color="rateDelta?.color"
        >
          <KSparkline :values="stats.rate.series" />
        </KMetric>
        <KMetric
          :value="stats.duration.value === null ? '–' : formatDuration(stats.duration.value)"
          label="Median duration"
          :delta="durationDelta?.text"
          :delta-color="durationDelta?.color"
        >
          <KSparkline :values="stats.duration.series" />
        </KMetric>
        <KMetric
          :value="stats.triggered === null ? '–' : `${stats.triggered}%`"
          label="Started by trigger"
        >
          <svg
            v-if="stats.triggered !== null"
            width="44"
            height="44"
            viewBox="0 0 36 36"
            aria-hidden="true"
          >
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="var(--surface-elevated)"
              stroke-width="5"
            />
            <circle
              v-if="stats.triggered >= 100"
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="var(--primary)"
              stroke-width="5"
            />
            <path
              v-else-if="stats.triggered > 0"
              :d="donutArc(stats.triggered)"
              fill="var(--primary)"
              stroke="var(--primary)"
              :stroke-width="DONUT_CORNER * 2"
              stroke-linejoin="round"
            />
          </svg>
        </KMetric>
      </div>
    </div>

    <div
      v-if="!runs.length"
      class="k-card flex flex-col items-center gap-4 px-6 py-16 text-center"
    >
      <img
        src="/mascot/mascotRight.png"
        alt="Knecht"
        class="h-20 w-auto drop-shadow-mascot"
      >
      <div>
        <div class="text-sm font-medium text-toned">
          No runs yet
        </div>
        <p class="mx-auto mt-1.5 max-w-105 text-2sm leading-normal text-muted">
          A run is one execution of a workflow against a project. Start a workflow from a
          project, a workflow, or a trigger, and it shows up here.
        </p>
      </div>
    </div>

    <div
      v-else
      class="k-card overflow-hidden"
    >
      <KSessionList
        :groups="sessionGroups"
        :run-to="r => runWorkspacePath(r.projectId, r.id)"
        show-project
      />
    </div>
  </div>
</template>
