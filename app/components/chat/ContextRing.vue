<script setup lang="ts">
const props = withDefaults(defineProps<{
  usage: { used: number, size: number, cost: number | null } | null
  hoverDelay?: number
}>(), {
  hoverDelay: 500,
})

const emit = defineEmits<{
  compact: []
}>()

const RADIUS = 6
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const HOVER_GRACE_MS = 300
const PANEL_LEAVE_MS = 300

const percent = computed(() => {
  if (!props.usage?.size) return null
  return Math.min(100, (props.usage.used / props.usage.size) * 100)
})
const dash = computed(() => CIRCUMFERENCE * (1 - (percent.value ?? 0) / 100))
const color = computed(() => {
  if (percent.value === null) return 'var(--text-dimmed)'
  if (percent.value >= 80) return 'var(--status-error)'
  if (percent.value >= 50) return 'var(--accent-orange)'
  return 'var(--primary)'
})

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}m`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}
const summary = computed(() => {
  if (!props.usage || percent.value === null) return null
  return `${percent.value.toFixed(1)}% · ${formatTokens(props.usage.used)}/${formatTokens(props.usage.size)}`
})

// Hover opens after a short dwell and closes with a grace period so the pointer can travel into the panel; a click pins it.
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const pinned = ref(false)
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

function show() {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  open.value = true
}
function scheduleOpen() {
  clearTimeout(closeTimer)
  if (open.value) return
  clearTimeout(openTimer)
  openTimer = setTimeout(show, props.hoverDelay)
}
function scheduleClose(ms: number) {
  clearTimeout(openTimer)
  if (pinned.value) return
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    open.value = false
  }, ms)
}
function toggle() {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  pinned.value = !pinned.value
  open.value = pinned.value
}
function unpin() {
  pinned.value = false
  open.value = false
}

function onDocumentClick(e: MouseEvent) {
  if (pinned.value && root.value && !root.value.contains(e.target as Node)) unpin()
}
function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && pinned.value) {
    e.stopPropagation()
    unpin()
  }
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown, true)
})
onUnmounted(() => {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown, true)
})

function compact() {
  unpin()
  emit('compact')
}
</script>

<template>
  <span
    ref="root"
    class="relative flex"
  >
    <button
      type="button"
      class="flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-elevated/60"
      :aria-expanded="open"
      aria-label="Context window usage"
      @mouseenter="scheduleOpen"
      @mouseleave="scheduleClose(HOVER_GRACE_MS)"
      @click="toggle"
    >
      <svg
        viewBox="0 0 16 16"
        class="size-4 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="8"
          cy="8"
          :r="RADIUS"
          fill="none"
          stroke="var(--border-accented)"
          stroke-width="2"
        />
        <circle
          cx="8"
          cy="8"
          :r="RADIUS"
          fill="none"
          :stroke="color"
          stroke-width="2"
          stroke-linecap="round"
          :stroke-dasharray="CIRCUMFERENCE"
          :stroke-dashoffset="dash"
          class="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
    </button>
    <div
      v-if="open"
      class="k-card absolute bottom-full left-0 z-20 mb-1 w-72 p-3 shadow-lg"
      @mouseenter="show"
      @mouseleave="scheduleClose(PANEL_LEAVE_MS)"
    >
      <div class="flex items-center justify-between gap-3">
        <span class="text-2sm text-highlighted">Context window</span>
        <span class="k-mono text-2xs text-muted">{{ summary ?? 'no usage yet' }}</span>
      </div>
      <div
        class="mt-2 h-1 overflow-hidden rounded-full"
        style="background: var(--border-accented)"
      >
        <div
          class="h-full rounded-full transition-[width] duration-500"
          :style="{ width: `${percent ?? 0}%`, background: color }"
        />
      </div>
      <div
        v-if="usage?.cost != null"
        class="mt-2 flex items-center justify-between text-2xs text-muted"
      >
        <span>Cost</span>
        <span class="k-mono">${{ usage.cost.toFixed(2) }}</span>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        size="xs"
        block
        class="mt-3"
        icon="i-lucide-fold-vertical"
        label="Compact context"
        :disabled="percent === null"
        @click="compact"
      />
    </div>
  </span>
</template>
