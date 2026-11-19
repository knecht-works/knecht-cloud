<script setup lang="ts">
import type { RunStatus, RunStatusMeta } from '~/utils/dashboard'
import { stripAnsi } from '#shared/utils/ansi'

export interface RunLogRow {
  id: number
  stepId: string
  label: string
  icon: string
  color: string
  error: string | null
  status: 'running' | 'success' | 'failed' | 'cancelled'
  statusMeta: RunStatusMeta
  depth: number
  iteration: number | null
  attempt: number
  logStart: number | null
  startedAt: string | number | Date | null
  finishedAt: string | number | Date | null
}

export interface LogRun {
  id: number
  label: string
  log: string
  rows: RunLogRow[]
  live: boolean
  status: RunStatus
  startedAt: string | number | Date | null
  finishedAt: string | number | Date | null
}

const props = defineProps<{
  runs: LogRun[]
  resizable?: boolean
}>()

type SectionKey = string

// ddev and shell output carry colour codes; cut in bytes first, then clean.
function trimEdges(text: string): string {
  return stripAnsi(text).replace(/^\n+|\n+$/g, '')
}

interface LogSection {
  key: SectionKey
  row: RunLogRow | null
  text: string
}

const preludeKey = (run: LogRun): SectionKey => `${run.id}:prelude`

// Clamped: the steps poll can deliver a row whose offset points past the log read in the same tick.
function runSections(run: LogRun): LogSection[] {
  const bytes = new TextEncoder().encode(run.log)
  const cuts = run.rows
    .map(r => ({ row: r, start: Math.min(r.logStart ?? 0, bytes.length) }))
    .sort((a, b) => a.start - b.start || a.row.id - b.row.id)
  if (!cuts.length) return [{ key: preludeKey(run), row: null, text: run.log }]
  const decoder = new TextDecoder()
  return [
    { key: preludeKey(run), row: null, text: trimEdges(decoder.decode(bytes.subarray(0, cuts[0]!.start))) },
    ...cuts.map((cut, i) => ({
      key: `${run.id}:${cut.row.id}`,
      row: cut.row,
      text: trimEdges(decoder.decode(bytes.subarray(cut.start, cuts[i + 1]?.start ?? bytes.length))),
    })),
  ]
}

const groups = computed(() => props.runs.map(run => ({ run, sections: runSections(run) })))
const sections = computed(() => groups.value.flatMap(g => g.sections))
const showRunHeaders = computed(() => props.runs.length > 1)
const live = computed(() => props.runs.some(r => r.live))

function preludeStatusMeta(run: LogRun) {
  if (run.rows.length) return RUN_STATUS_META.success
  if (run.live) return RUN_STATUS_META.running
  return RUN_STATUS_META[run.status]
}
const now = useNow()
function preludeDuration(run: LogRun) {
  return runDuration(run.startedAt, run.rows[0]?.startedAt ?? run.finishedAt, now.value)
}

const { el: container, height: logHeight, startResize } = useResizableHeight(160)
const { stick, onScroll } = useStickToBottom(container, () => props.runs.map(r => r.log.length).join())

const collapsed = ref(new Set<SectionKey>())
function toggleCollapsed(key: SectionKey) {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

const activeKey = ref<SectionKey | null>(null)
function updateActive() {
  const node = container.value
  if (!node) return
  if (stick.value || (live.value && node.scrollHeight <= node.clientHeight)) {
    activeKey.value = sections.value[sections.value.length - 1]?.key ?? null
    return
  }
  const pos = node.scrollTop + 60
  let current = sections.value[0]?.key ?? null
  for (const seg of sections.value) {
    const el = anchors.get(seg.key)
    if (el && el.offsetTop <= pos) current = seg.key
  }
  activeKey.value = current
}
function handleScroll() {
  onScroll()
  updateActive()
}
// A log too short to scroll fires no scroll events, so recompute on section changes.
watch(sections, async () => {
  await nextTick()
  updateActive()
}, { immediate: true })

const anchors = new Map<SectionKey, HTMLElement>()
function setAnchor(key: SectionKey, el: unknown) {
  if (el instanceof HTMLElement) anchors.set(key, el)
  else anchors.delete(key)
}

// Unpin first (a live run would yank the view back down). scrollTo on the
// container, not scrollIntoView, which would also scroll the page.
function jumpTo(key: SectionKey) {
  const target = anchors.get(key)
  if (!container.value || !target) return
  if (collapsed.value.has(key)) toggleCollapsed(key)
  stick.value = false
  container.value.scrollTo({ top: target.offsetTop })
  activeKey.value = key
}
</script>

<template>
  <div
    class="flex flex-col lg:flex-row lg:flex-wrap"
    :style="{ '--log-h': logHeight ? `${logHeight}px` : '37.5rem' }"
  >
    <nav class="k-scrollbar-none order-1 max-h-40 flex-none overflow-y-auto border-b border-muted lg:order-2 lg:max-h-(--log-h) lg:w-60 lg:border-b-0 lg:border-l">
      <ul
        v-for="(g, gi) in groups"
        :key="g.run.id"
        class="py-1.5"
        :class="gi ? 'border-t border-muted' : ''"
      >
        <li v-if="showRunHeaders">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 px-3.5 pb-1 pt-1.5 text-left"
            @click="jumpTo(preludeKey(g.run))"
          >
            <span class="k-mono min-w-0 flex-1 truncate text-2xs text-dimmed">{{ g.run.label }} #{{ g.run.id }}</span>
            <KStatusDot
              :color="RUN_STATUS_META[g.run.status].dot"
              :pulse="g.run.live"
              :size="5"
            />
          </button>
        </li>
        <li
          v-for="seg in g.sections"
          :key="seg.key"
        >
          <button
            type="button"
            class="relative flex w-full cursor-pointer items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-elevated/50"
            :class="activeKey === seg.key || seg.row?.status === 'running' ? 'bg-elevated/50' : ''"
            :style="seg.row?.depth ? { paddingLeft: `${14 + seg.row.depth * 14}px` } : undefined"
            @click="jumpTo(seg.key)"
          >
            <span
              v-if="activeKey === seg.key"
              class="absolute inset-y-1 left-0 w-0.5 rounded-full"
              :style="{ background: (seg.row?.statusMeta ?? preludeStatusMeta(g.run)).text }"
            />
            <UIcon
              :name="seg.row?.icon ?? 'i-lucide-container'"
              class="size-3.5 flex-none"
              :class="seg.row ? '' : 'text-dimmed'"
              :style="seg.row ? { color: seg.row.color } : undefined"
            />
            <span
              class="min-w-0 flex-1 truncate text-2sm"
              :class="seg.row?.status === 'running' ? 'text-highlighted' : 'text-muted'"
              :style="seg.row?.status === 'failed' ? 'color: var(--status-error)' : undefined"
            >{{ seg.row?.label ?? 'Preparation' }}</span>
            <span class="k-mono text-2xs text-dimmed">{{ seg.row ? runDuration(seg.row.startedAt, seg.row.finishedAt, now) : preludeDuration(g.run) }}</span>
            <KStatusDot
              :color="(seg.row?.statusMeta ?? preludeStatusMeta(g.run)).dot"
              :pulse="(seg.row?.statusMeta ?? preludeStatusMeta(g.run)).pulse"
              :size="5"
            />
          </button>
        </li>
      </ul>
    </nav>

    <!-- `relative` so the anchors' offsetTop resolves against this container. -->
    <div
      ref="container"
      class="k-scrollbar-none relative order-2 max-h-(--log-h) min-w-0 flex-1 overflow-y-auto lg:order-1"
      @scroll="handleScroll"
    >
      <template
        v-for="(g, gi) in groups"
        :key="g.run.id"
      >
        <div
          v-if="showRunHeaders"
          class="flex items-center gap-2 px-4.5 pb-1.5 pt-3"
          :class="gi ? 'border-t border-muted' : ''"
        >
          <KStatusDot
            :color="RUN_STATUS_META[g.run.status].dot"
            :pulse="g.run.live"
            :size="5"
          />
          <span class="k-mono truncate text-2xs text-muted">{{ g.run.label }} #{{ g.run.id }}</span>
          <span class="k-mono flex-none text-2xs text-dimmed">· {{ RUN_STATUS_META[g.run.status].label.toLowerCase() }} · {{ timeAgo(g.run.startedAt) }}</span>
        </div>
        <section
          v-for="(seg, i) in g.sections"
          :key="seg.key"
          :ref="el => setAnchor(seg.key, el)"
          :class="i || (gi && !showRunHeaders) ? 'border-t border-muted' : ''"
        >
          <header
            class="sticky top-0 z-10 flex cursor-pointer select-none items-center gap-3 px-4.5 py-3"
            style="background: var(--surface-muted)"
            @click="toggleCollapsed(seg.key)"
          >
            <span
              v-if="activeKey === seg.key"
              class="absolute inset-y-2.5 left-0 w-0.5 rounded-full"
              :style="{ background: (seg.row?.statusMeta ?? preludeStatusMeta(g.run)).text }"
            />
            <KStepIcon
              :icon="seg.row?.icon ?? 'i-lucide-container'"
              :size="30"
              :radius="7"
              :color="seg.row?.color ?? 'var(--text-dimmed)'"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <span class="truncate text-2sm text-highlighted">{{ seg.row?.label ?? 'Preparation' }}</span>
                <span
                  v-if="seg.row"
                  class="k-mono text-3xs text-dimmed"
                >{{ seg.row.stepId }}</span>
                <span
                  v-if="seg.row && seg.row.iteration !== null"
                  class="k-mono text-3xs text-dimmed"
                >#{{ seg.row.iteration + 1 }}</span>
                <span
                  v-if="seg.row && seg.row.attempt > 1"
                  class="k-mono text-3xs text-accent-orange"
                >{{ seg.row.attempt }} attempts</span>
              </div>
              <p
                v-if="seg.row?.error"
                class="truncate text-xs"
                style="color: var(--status-error)"
              >
                {{ seg.row.error }}
              </p>
            </div>
            <UIcon
              name="i-lucide-chevron-down"
              class="size-3.5 flex-none text-dimmed transition-transform"
              :class="collapsed.has(seg.key) ? '-rotate-90' : ''"
            />
          </header>
          <pre
            v-if="seg.text && !collapsed.has(seg.key)"
            class="k-mono whitespace-pre-wrap break-words px-4.5 pb-3.5 text-xs leading-loose text-muted"
          >{{ seg.text }}</pre>
          <p
            v-else-if="seg.row?.status === 'running' && !collapsed.has(seg.key)"
            class="px-4.5 pb-3.5 text-xs text-dimmed"
          >
            …
          </p>
        </section>
        <p
          v-if="!g.run.log"
          class="px-4.5 py-4 text-xs text-dimmed"
        >
          …
        </p>
      </template>
    </div>
    <KResizeHandle
      v-if="resizable"
      class="order-3 w-full border-t border-muted"
      @start="startResize"
    />
  </div>
</template>
