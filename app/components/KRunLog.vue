<script setup lang="ts">
import type { RunStatus, RunStatusMeta } from '~/utils/dashboard'

// The run's FULL log as one continuous stream, cut into per-step segments at
// the byte offsets the runner recorded (run_steps.logStart), with a step
// index rail beside it: clicking a step scrolls the log to that step's
// position. Nothing is hidden: retry banners, agent-git lines and the
// closing ✓/✗ sit in the segment they chronologically belong to.

// One timeline row as the run workspace builds it (run_steps row + registry
// styling). Structural subset: the workspace passes its richer rows through.
export interface RunLogRow {
  id: number
  stepId: string
  label: string
  icon: string
  color: string
  error: string | null
  status: 'running' | 'success' | 'failed'
  statusMeta: RunStatusMeta
  depth: number
  iteration: number | null
  attempt: number
  logStart: number | null
  startedAt: string | Date | null
  finishedAt: string | Date | null
}

const props = defineProps<{
  /** The full run log (runs.log), polled while live. */
  log: string
  /** Timeline rows in execution order (workflow steps + follow-ups). */
  rows: RunLogRow[]
  /** A run or follow-up is executing: keep following the tail. */
  live: boolean
  /** Run facts for the synthetic Preparation entry (checkout + env boot
   *  happen before any step row exists). */
  runStatus: RunStatus
  runStartedAt: string | Date | null
  runFinishedAt: string | Date | null
}>()

// ── Byte segmentation ──────────────────────────────────────────────────────
// Encoded once per actual log change: `log` is a string prop, so a poll tick
// that appended nothing patches nothing and this never re-runs. The offsets
// are bytes (see runLogBytes in daemon/runner.ts), hence the encoder.
const logBytes = computed(() => new TextEncoder().encode(props.log))

// Cut points as a value-stable string: the poll replaces the rows array
// every tick with identical content, and Vue only invalidates a computed's
// dependents when its VALUE changes, so segmentation below re-runs only
// when a row appeared, not on every poll. Every row records its offset at
// insert (runner/followups); `?? 0` only guards the type's nullability.
const cutsKey = computed(() => props.rows
  .map(r => ({ id: r.id, start: r.logStart ?? 0 }))
  .sort((a, b) => a.start - b.start || a.id - b.id)
  .map(c => `${c.id}:${c.start}`)
  .join('|'))
const hasCuts = computed(() => cutsKey.value !== '')

// Every section reads like the Preparation one: the step's '▶ <label>'
// banner stays as the slice's first line, so the body always SAYS what the
// step did. Only blank edges go: they are the banners' framing newlines,
// which read as random gaps once the log is cut into sections.
function trimEdges(text: string): string {
  return text.replace(/^\n+|\n+$/g, '')
}

// A rendered section of the log: the prelude (row null) or one row's slice.
interface LogSection {
  key: number | 'prelude'
  row: RunLogRow | null
  text: string
}

// Cut the byte stream at the offsets and decode each slice. Offsets are
// clamped: the steps poll can deliver a row inserted after the (slightly
// older) log was read, so its offset may point past the end; the empty
// segment heals on the next tick. Boundaries always fall between complete
// appends, so decoding never splits a code point. Without rows yet (a run
// still preparing) the whole log is the prelude.
const sections = computed<LogSection[]>(() => {
  const bytes = logBytes.value
  if (!hasCuts.value) return [{ key: 'prelude', row: null, text: props.log }]
  const rowById = new Map(props.rows.map(r => [r.id, r]))
  const cuts = cutsKey.value.split('|').map((c) => {
    const [id, start] = c.split(':')
    return { id: Number(id), start: Math.min(Number(start), bytes.length) }
  })
  const decoder = new TextDecoder()
  const out: LogSection[] = [
    { key: 'prelude', row: null, text: trimEdges(decoder.decode(bytes.subarray(0, cuts[0]!.start))) },
  ]
  for (const [i, cut] of cuts.entries()) {
    const end = cuts[i + 1]?.start ?? bytes.length
    out.push({
      key: cut.id,
      row: rowById.get(cut.id) ?? null,
      text: trimEdges(decoder.decode(bytes.subarray(cut.start, end))),
    })
  }
  return out
})

// ── The synthetic Preparation entry (checkout + boot, no run_steps row) ────
const preludeStatusMeta = computed(() => {
  if (props.rows.length) return RUN_STATUS_META.success
  if (props.live) return RUN_STATUS_META.running
  return RUN_STATUS_META[props.runStatus]
})
const preludeDuration = computed(() =>
  runDuration(props.runStartedAt, props.rows[0]?.startedAt ?? props.runFinishedAt))

// ── Scroll handling (stick-to-bottom latch, shared with KLogView) ──────────
const container = ref<HTMLElement | null>(null)
const { stick, onScroll } = useStickToBottom(container, () => props.log)

// Segment anchors keyed by row id ('prelude' for the synthetic entry).
// Function refs, so v-for cleanup nulls stale entries.
const anchors = new Map<number | 'prelude', HTMLElement>()
function setAnchor(key: number | 'prelude', el: unknown) {
  if (el instanceof HTMLElement) anchors.set(key, el)
  else anchors.delete(key)
}

// Rail click: unpin FIRST (a live run must not yank the view back down),
// then jump. scrollTo on the container, not scrollIntoView: the latter
// would also scroll the page. offsetTop is container-relative because the
// container is positioned `relative`.
function jumpTo(key: number | 'prelude') {
  const target = anchors.get(key)
  if (!container.value || !target) return
  stick.value = false
  container.value.scrollTo({ top: target.offsetTop })
}
</script>

<template>
  <div class="flex flex-col lg:flex-row">
    <!-- The step index: right of the log on lg+, a compact block ABOVE it on
         small screens (order utilities; below the log it couldn't be seen
         while reading). -->
    <nav class="k-scrollbar-none order-1 max-h-40 flex-none overflow-y-auto border-b border-muted lg:order-2 lg:max-h-150 lg:w-60 lg:border-b-0 lg:border-l">
      <ul class="py-1.5">
        <li>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-elevated/50"
            @click="jumpTo('prelude')"
          >
            <UIcon
              name="i-lucide-container"
              class="size-3.5 flex-none text-dimmed"
            />
            <span class="min-w-0 flex-1 truncate text-2sm text-muted">Preparation</span>
            <span class="k-mono text-2xs text-dimmed">{{ preludeDuration }}</span>
            <KStatusDot
              :color="preludeStatusMeta.dot"
              :pulse="preludeStatusMeta.pulse"
              :size="5"
            />
          </button>
        </li>
        <li
          v-for="r in rows"
          :key="r.id"
        >
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-elevated/50"
            :class="r.status === 'running' ? 'bg-elevated/50' : ''"
            :style="r.depth ? { paddingLeft: `${14 + r.depth * 14}px` } : undefined"
            @click="jumpTo(r.id)"
          >
            <UIcon
              :name="r.icon"
              class="size-3.5 flex-none"
              :style="{ color: r.color }"
            />
            <span
              class="min-w-0 flex-1 truncate text-2sm"
              :class="r.status === 'running' ? 'text-highlighted' : 'text-muted'"
              :style="r.status === 'failed' ? 'color: var(--status-error)' : undefined"
            >{{ r.label }}</span>
            <span class="k-mono text-2xs text-dimmed">{{ runDuration(r.startedAt, r.finishedAt) }}</span>
            <KStatusDot
              :color="r.statusMeta.dot"
              :pulse="r.statusMeta.pulse"
              :size="5"
            />
          </button>
        </li>
      </ul>
    </nav>

    <!-- The continuous log: ONE scroll container holding every segment.
         `relative` so the anchors' offsetTop resolves against it. -->
    <div
      ref="container"
      class="k-scrollbar-none relative order-2 max-h-150 min-w-0 flex-1 overflow-y-auto lg:order-1"
      @scroll="onScroll"
    >
      <section
        v-for="(seg, i) in sections"
        :key="seg.key"
        :ref="el => setAnchor(seg.key, el)"
        :class="i ? 'border-t border-muted' : ''"
      >
        <!-- The step row, in the app's standard list-row look (icon tile,
             label + snippet, duration, status dot); sticky within the
             container so a long segment stays labeled while it scrolls. -->
        <header
          class="sticky top-0 z-10 flex items-center gap-3 px-4.5 py-3"
          style="background: var(--surface-muted)"
        >
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
          <span class="k-mono text-2xs text-dimmed">
            {{ seg.row ? runDuration(seg.row.startedAt, seg.row.finishedAt) : preludeDuration }}
          </span>
          <KStatusDot
            :color="(seg.row?.statusMeta ?? preludeStatusMeta).dot"
            :pulse="(seg.row?.statusMeta ?? preludeStatusMeta).pulse"
            :size="6"
          />
        </header>
        <!-- The step's output, readable and in order. Empty slices happen (a
             composite's banner-only slice, a row that just started): a dim
             placeholder while running, just the row itself after. -->
        <pre
          v-if="seg.text"
          class="k-mono whitespace-pre-wrap break-words px-4.5 pb-3.5 text-xs leading-loose text-muted"
        >{{ seg.text }}</pre>
        <p
          v-else-if="seg.row?.status === 'running'"
          class="px-4.5 pb-3.5 text-xs text-dimmed"
        >
          …
        </p>
      </section>
      <p
        v-if="!log"
        class="px-4.5 py-4 text-xs text-dimmed"
      >
        …
      </p>
    </div>
  </div>
</template>
