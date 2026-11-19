<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { RunStatus, SessionGroup } from '~/utils/dashboard'
import type { EnvState, EnvTransition } from '#shared/utils/run'
import { useNow } from '~/composables/useNow'
import { ref, watch, nextTick, onMounted } from 'vue'
import { sessionObjectMeta, timeAgo, DOT_COLOR_VAR, runStatusMeta, runDuration } from '~/utils/dashboard'

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
  sessionTo: (group: SessionGroup<Run>) => RouteLocationRaw
  replace?: boolean
  selectedSessionId?: number | null
  showProject?: boolean
  hideRuns?: boolean
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

// A later run of the session, such as a started preview, has no title of its own.
function sessionTitle(g: SessionGroup<Run>): string {
  const o = g.objects[0]
  if (o) return o.title ?? `${sessionObjectMeta(o.integration, o.kind).prefix}${o.key}`
  return g.runs.find(r => r.title)?.title ?? g.runs[0]!.workflow
}

const rowEls = new Map<number, HTMLElement>()
function setRowEl(sessionId: number, el: unknown) {
  if (el instanceof HTMLElement) rowEls.set(sessionId, el)
  else rowEls.delete(sessionId)
}

const hoveredSessionId = ref<number | null>(null)
const box = ref<{ top: number, height: number } | null>(null)
// Only a box already on screen slides; one that appears just shows up where it belongs.
const boxSlides = ref(false)
function placeBox() {
  const id = hoveredSessionId.value ?? props.selectedSessionId
  const el = id == null ? undefined : rowEls.get(id)
  boxSlides.value = !!box.value
  box.value = el ? { top: el.offsetTop, height: el.offsetHeight } : null
}
watch([hoveredSessionId, () => props.selectedSessionId, () => props.groups], () => nextTick(placeBox))
onMounted(placeBox)

function runTooltip(r: Run): string {
  return [`#${r.id}`, r.title ? r.workflow : '', `ran ${timeAgo(r.startedAt ?? r.createdAt)}`].filter(Boolean).join(' · ')
}
</script>

<template>
  <div
    v-if="hideRuns"
    class="py-1.5 pl-1.5 pr-[calc(6px-(100cqw-100%))]"
  >
    <div
      class="relative flex flex-col gap-px"
      @mouseleave="hoveredSessionId = null"
    >
      <span
        v-if="box"
        class="pointer-events-none absolute inset-x-0 top-0 rounded-md border border-default bg-(--surface-glass) ease-out"
        :class="boxSlides ? 'transition-[translate,height] duration-200' : ''"
        :style="{ translate: `0 ${box.top}px`, height: `${box.height}px` }"
      />
      <div
        v-for="g in groups"
        :key="g.sessionId"
        :ref="el => setRowEl(g.sessionId, el)"
        class="group relative flex h-9 items-center gap-2.5 rounded-md pr-2.5"
        @mouseenter="hoveredSessionId = g.sessionId"
      >
        <span
          v-if="g.sessionId === selectedSessionId"
          class="pointer-events-none absolute inset-y-2 -left-px w-0.5 rounded-sm"
          :style="{ background: DOT_COLOR_VAR[runStatusMeta(g.runs[0]!).dot], boxShadow: `0 0 8px ${DOT_COLOR_VAR[runStatusMeta(g.runs[0]!).dot]}` }"
        />
        <NuxtLink
          :to="sessionTo(g)"
          :replace="replace"
          class="absolute inset-0 z-1"
          :aria-label="sessionLabel(g)"
          :aria-current="g.sessionId === selectedSessionId ? 'true' : undefined"
        />
        <KSessionGroupHeader
          class="min-w-0 flex-1"
          :objects="g.objects"
          :title="sessionTitle(g)"
          :to="sessionTo(g)"
          :replace="replace"
          :quiet="g.sessionId !== selectedSessionId"
        />
        <KStatusDot
          v-if="runStatusMeta(g.runs[0]!).pulse"
          :color="runStatusMeta(g.runs[0]!).dot"
          pulse
          :size="6"
        />
      </div>
    </div>
  </div>
  <template v-else>
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
</template>
