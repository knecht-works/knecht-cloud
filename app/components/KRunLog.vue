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

const props = defineProps<{
  log: string
  rows: RunLogRow[]
  live: boolean
  runStatus: RunStatus
  runStartedAt: string | number | Date | null
  runFinishedAt: string | number | Date | null
}>()

const logBytes = computed(() => new TextEncoder().encode(props.log))

const cutsKey = computed(() => props.rows
  .map(r => ({ id: r.id, start: r.logStart ?? 0 }))
  .sort((a, b) => a.start - b.start || a.id - b.id)
  .map(c => `${c.id}:${c.start}`)
  .join('|'))
const hasCuts = computed(() => cutsKey.value !== '')

// ddev and shell output carry colour codes; cut in bytes first, then clean.
function trimEdges(text: string): string {
  return stripAnsi(text).replace(/^\n+|\n+$/g, '')
}

interface LogSection {
  key: number | 'prelude'
  row: RunLogRow | null
  text: string
}

// Clamped: the steps poll can deliver a row whose offset points past the log read in the same tick.
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

const preludeStatusMeta = computed(() => {
  if (props.rows.length) return RUN_STATUS_META.success
  if (props.live) return RUN_STATUS_META.running
  return RUN_STATUS_META[props.runStatus]
})
const preludeDuration = computed(() =>
  runDuration(props.runStartedAt, props.rows[0]?.startedAt ?? props.runFinishedAt))

const container = ref<HTMLElement | null>(null)
const { stick, onScroll } = useStickToBottom(container, () => props.log)

const collapsed = ref(new Set<number | 'prelude'>())
function toggleCollapsed(key: number | 'prelude') {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
}

const activeKey = ref<number | 'prelude'>('prelude')
function updateActive() {
  const node = container.value
  if (!node) return
  if (stick.value || (props.live && node.scrollHeight <= node.clientHeight)) {
    activeKey.value = sections.value[sections.value.length - 1]!.key
    return
  }
  const pos = node.scrollTop + 60
  let current: number | 'prelude' = 'prelude'
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

const anchors = new Map<number | 'prelude', HTMLElement>()
function setAnchor(key: number | 'prelude', el: unknown) {
  if (el instanceof HTMLElement) anchors.set(key, el)
  else anchors.delete(key)
}

// Unpin first (a live run would yank the view back down). scrollTo on the
// container, not scrollIntoView, which would also scroll the page.
function jumpTo(key: number | 'prelude') {
  const target = anchors.get(key)
  if (!container.value || !target) return
  if (collapsed.value.has(key)) toggleCollapsed(key)
  stick.value = false
  container.value.scrollTo({ top: target.offsetTop })
  activeKey.value = key
}
</script>

<template>
  <div class="flex flex-col lg:flex-row">
    <nav class="k-scrollbar-none order-1 max-h-40 flex-none overflow-y-auto border-b border-muted lg:order-2 lg:max-h-150 lg:w-60 lg:border-b-0 lg:border-l">
      <ul class="py-1.5">
        <li>
          <button
            type="button"
            class="relative flex w-full cursor-pointer items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-elevated/50"
            :class="activeKey === 'prelude' ? 'bg-elevated/50' : ''"
            @click="jumpTo('prelude')"
          >
            <span
              v-if="activeKey === 'prelude'"
              class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
            />
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
            class="relative flex w-full cursor-pointer items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-elevated/50"
            :class="activeKey === r.id || r.status === 'running' ? 'bg-elevated/50' : ''"
            :style="r.depth ? { paddingLeft: `${14 + r.depth * 14}px` } : undefined"
            @click="jumpTo(r.id)"
          >
            <span
              v-if="activeKey === r.id"
              class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
            />
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

    <!-- `relative` so the anchors' offsetTop resolves against this container. -->
    <div
      ref="container"
      class="k-scrollbar-none relative order-2 max-h-150 min-w-0 flex-1 overflow-y-auto lg:order-1"
      @scroll="handleScroll"
    >
      <section
        v-for="(seg, i) in sections"
        :key="seg.key"
        :ref="el => setAnchor(seg.key, el)"
        :class="i ? 'border-t border-muted' : ''"
      >
        <header
          class="sticky top-0 z-10 flex cursor-pointer select-none items-center gap-3 px-4.5 py-3"
          style="background: var(--surface-muted)"
          @click="toggleCollapsed(seg.key)"
        >
          <span
            v-if="activeKey === seg.key"
            class="absolute inset-y-2.5 left-0 w-0.5 rounded-full bg-primary"
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
        v-if="!log"
        class="px-4.5 py-4 text-xs text-dimmed"
      >
        …
      </p>
    </div>
  </div>
</template>
