<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { RunStatus, SessionGroup } from '~/utils/dashboard'
import type { EnvState, EnvTransition } from '#shared/utils/run'
import { useNow } from '~/composables/useNow'
import { ref } from 'vue'
import { sessionTitle, timeAgo, DOT_COLOR_VAR, runStatusMeta, runDuration } from '~/utils/dashboard'
import KSessionGroupHeader from '~/components/KSessionGroupHeader.vue'
import KStatusDot from '~/components/KStatusDot.vue'
import { NuxtLink, UTooltip } from '#components'

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

defineProps<{
  groups: SessionGroup<Run>[]
  sessionTo: (group: SessionGroup<Run>) => RouteLocationRaw
  replace?: boolean
  selectedSessionId?: number | null
  showProject?: boolean
}>()

const VISIBLE_RUNS = 3

const now = useNow()
const expanded = ref(new Set<number>())

function visibleRuns(g: SessionGroup<Run>): Run[] {
  return g.runs.length <= VISIBLE_RUNS || expanded.value.has(g.sessionId) ? g.runs : g.runs.slice(0, VISIBLE_RUNS)
}

function expand(sessionId: number) {
  expanded.value = new Set(expanded.value).add(sessionId)
}

function sessionLabel(g: SessionGroup<Run>): string {
  return `Open session ${sessionTitle(g)}`
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
    class="relative pb-1 pl-2.5 pt-2.5 pr-[calc(18px-(100cqw-100%))] transition-colors hover:bg-elevated/30"
    :class="[gi ? 'border-t border-muted' : '', g.sessionId === selectedSessionId ? 'bg-elevated/30' : '']"
  >
    <!-- Stretched over the group; the links, tooltips and buttons inside sit above it on z-2. -->
    <NuxtLink
      :to="sessionTo(g)"
      :replace="replace"
      class="absolute inset-0 z-1"
      :aria-label="sessionLabel(g)"
      :aria-current="g.sessionId === selectedSessionId ? 'true' : undefined"
    />
    <KSessionGroupHeader
      :objects="g.objects"
      :title="sessionTitle(g)"
      :to="sessionTo(g)"
      :replace="replace"
      :project="showProject ? { id: g.runs[0]!.projectId, name: g.runs[0]!.project } : undefined"
    />
    <div class="relative ml-4.5 mt-0.5 pl-1 before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-(--border-default)">
      <span
        v-if="g.sessionId === selectedSessionId"
        class="pointer-events-none absolute inset-y-1.5 -left-[0.5px] w-0.5 rounded-full"
        :style="{ background: DOT_COLOR_VAR[runStatusMeta(g.runs[0]!).dot] }"
      />
      <div
        v-for="r in visibleRuns(g)"
        :key="r.id"
        class="relative flex h-6 items-center gap-2.5 pl-2.5 text-2sm"
        :class="g.sessionId === selectedSessionId ? 'text-highlighted' : 'text-muted'"
      >
        <KStatusDot
          :color="runStatusMeta(r).dot"
          :pulse="runStatusMeta(r).pulse"
          :size="6"
        />
        <span class="min-w-0 truncate">{{ r.title ?? r.workflow }}</span>
        <UTooltip
          :text="runTooltip(r)"
          :content="{ side: 'left' }"
        >
          <span class="relative z-2 ml-auto flex-none text-xs font-normal tabular-nums text-dimmed">{{ runDuration(r.startedAt, r.finishedAt, now) }}</span>
        </UTooltip>
      </div>
      <button
        v-if="visibleRuns(g).length < g.runs.length"
        type="button"
        class="relative z-2 px-2.5 py-0.5 text-xs text-dimmed transition-colors hover:text-muted"
        @click="expand(g.sessionId)"
      >
        + {{ g.runs.length - visibleRuns(g).length }} earlier
      </button>
    </div>
  </div>
</template>
