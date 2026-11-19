<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

type TimeValue = string | number | Date | null | undefined

interface Run {
  id: number
  status: RunStatus
  envState: EnvState
  envTransition?: EnvTransition | null
  workflow: string
  title: string | null
  projectId: number
  project: string
  startedAt: TimeValue
  finishedAt: TimeValue
  createdAt: TimeValue
}

const props = defineProps<{
  groups: SessionGroup<Run>[]
  runTo: (run: Run) => RouteLocationRaw
  replace?: boolean
  selectedRunId?: number | null
  showProject?: boolean
}>()

const VISIBLE_RUNS = 3
// The h-6 of a run row: the indicator slides between rows by this step.
const RUN_ROW_PX = 24

const now = useNow()
const expanded = ref(new Set<number>())
const hoveredRunId = ref<number | null>(null)

function visibleRuns(g: SessionGroup<Run>): Run[] {
  if (g.runs.length <= VISIBLE_RUNS || expanded.value.has(g.sessionId)) return g.runs
  const shown = g.runs.slice(0, VISIBLE_RUNS)
  return props.selectedRunId != null && g.runs.some(r => r.id === props.selectedRunId) && !shown.some(r => r.id === props.selectedRunId)
    ? g.runs
    : shown
}

function expand(sessionId: number) {
  expanded.value = new Set(expanded.value).add(sessionId)
}

function indicator(g: SessionGroup<Run>) {
  const runs = visibleRuns(g)
  const hovered = runs.findIndex(r => r.id === hoveredRunId.value)
  const index = hovered >= 0 ? hovered : runs.findIndex(r => r.id === props.selectedRunId)
  return index >= 0 ? { index, color: DOT_COLOR_VAR[runStatusMeta(runs[index]!).dot] } : null
}

function runTooltip(r: Run): string {
  return [`#${r.id}`, r.title ? r.workflow : '', `ran ${timeAgo(r.startedAt ?? r.createdAt)}`].filter(Boolean).join(' · ')
}
</script>

<template>
  <!-- The right padding gives back the scrollbar's width (container minus content), so times end where the panel header does. -->
  <div
    v-for="(g, gi) in groups"
    :key="g.sessionId"
    class="py-1 pl-2.5 pr-[calc(18px-(100cqw-100%))]"
    :class="[gi ? 'border-t border-muted' : '', g.objects.length ? 'pt-2.5' : '']"
  >
    <KSessionGroupHeader
      v-if="g.objects.length"
      :objects="g.objects"
      :project="showProject ? { id: g.runs[0]!.projectId, name: g.runs[0]!.project } : undefined"
    />
    <div :class="g.objects.length ? 'relative ml-4.5 mt-0.5 pl-1 before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-(--border-default)' : ''">
      <span
        v-if="g.objects.length"
        class="pointer-events-none absolute -left-[0.5px] top-0.5 h-5 w-0.5 rounded-full ease-out"
        :class="indicator(g) ? 'transition-[translate,opacity,background-color] duration-200' : 'opacity-0 transition-opacity duration-150'"
        :style="indicator(g) ? { translate: `0 ${indicator(g)!.index * RUN_ROW_PX}px`, background: indicator(g)!.color } : undefined"
      />
      <NuxtLink
        v-for="r in visibleRuns(g)"
        :key="r.id"
        :to="runTo(r)"
        :replace="replace"
        class="relative flex items-center gap-2.5 transition-colors hover:text-highlighted"
        :class="[
          g.objects.length ? 'h-6 pl-2.5 text-2sm' : 'py-1 pl-2 text-sm font-medium',
          r.id === selectedRunId ? 'text-highlighted' : g.objects.length ? 'text-muted' : 'text-highlighted',
        ]"
        :aria-current="r.id === selectedRunId ? 'true' : undefined"
        @mouseenter="hoveredRunId = r.id"
        @mouseleave="hoveredRunId = null"
      >
        <span
          v-if="r.id === selectedRunId && !g.objects.length"
          class="absolute inset-y-0.5 -left-2 w-0.5 rounded-full"
          :style="{ background: DOT_COLOR_VAR[runStatusMeta(r).dot] }"
        />
        <span
          v-if="!g.objects.length"
          class="grid size-5 flex-none place-items-center rounded-md bg-(--surface-elevated)"
        >
          <KStatusDot
            :color="runStatusMeta(r).dot"
            :pulse="runStatusMeta(r).pulse"
            :size="6"
          />
        </span>
        <KStatusDot
          v-else
          :color="runStatusMeta(r).dot"
          :pulse="runStatusMeta(r).pulse"
          :size="6"
        />
        <span class="min-w-0 truncate">{{ r.title ?? r.workflow }}</span>
        <span
          v-if="showProject && !g.objects.length"
          class="hidden min-w-0 truncate text-xs font-normal text-dimmed md:block"
        >{{ r.project }}</span>
        <UTooltip
          :text="runTooltip(r)"
          :content="{ side: 'left' }"
        >
          <span class="ml-auto flex-none text-xs font-normal tabular-nums text-dimmed">{{ runDuration(r.startedAt, r.finishedAt, now) }}</span>
        </UTooltip>
      </NuxtLink>
      <button
        v-if="visibleRuns(g).length < g.runs.length"
        type="button"
        class="px-2.5 py-0.5 text-xs text-dimmed transition-colors hover:text-muted"
        @click="expand(g.sessionId)"
      >
        + {{ g.runs.length - visibleRuns(g).length }} earlier
      </button>
    </div>
  </div>
</template>
