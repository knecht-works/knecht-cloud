<script setup lang="ts">
import { lineDiff } from '#shared/utils/line-diff'
import type { ChatItem } from '~/composables/useSessionTranscript'

const props = defineProps<{ item: ChatItem }>()

const TOOL_ICON: Record<string, string> = {
  read: 'i-lucide-file-text',
  edit: 'i-lucide-pencil-line',
  delete: 'i-lucide-trash-2',
  move: 'i-lucide-move',
  search: 'i-lucide-search',
  execute: 'i-lucide-terminal',
  think: 'i-lucide-brain',
  fetch: 'i-lucide-globe',
  switch_mode: 'i-lucide-toggle-left',
}

const open = ref(false)
const hasDetails = computed(() => !!(props.item.output || props.item.diff))
const running = computed(() => props.item.status === 'pending' || props.item.status === 'in_progress')

const diffLines = computed(() => props.item.diff ? lineDiff(props.item.diff.oldText ?? '', props.item.diff.newText) : [])
const diffCounts = computed(() => ({
  added: diffLines.value.filter(l => l.type === 'added').length,
  removed: diffLines.value.filter(l => l.type === 'removed').length,
}))
</script>

<template>
  <div class="min-w-0">
    <button
      type="button"
      class="group flex h-6 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left text-xs"
      :class="hasDetails ? 'cursor-pointer hover:bg-elevated/60' : 'cursor-default'"
      @click="hasDetails && (open = !open)"
    >
      <span class="flex size-4 flex-none items-center justify-center">
        <UIcon
          v-if="running"
          name="i-lucide-loader-circle"
          class="size-3.5 animate-spin text-dimmed"
        />
        <UIcon
          v-else-if="item.status === 'failed'"
          name="i-lucide-x"
          class="size-3.5"
          style="color: var(--status-error)"
        />
        <UIcon
          v-else
          :name="TOOL_ICON[item.kind ?? ''] ?? 'i-lucide-wrench'"
          class="size-3.5 text-dimmed"
        />
      </span>
      <span
        class="k-mono min-w-0 flex-1 truncate"
        :class="running ? 'text-toned' : 'text-muted'"
      >{{ item.text }}</span>
      <span
        v-if="item.diff"
        class="k-mono flex-none text-2xs"
      >
        <span style="color: var(--text-primary)">+{{ diffCounts.added }}</span>
        <span
          class="ml-1"
          style="color: var(--status-error)"
        >-{{ diffCounts.removed }}</span>
      </span>
      <UIcon
        v-if="hasDetails"
        name="i-lucide-chevron-down"
        class="size-3 flex-none text-dimmed transition-[opacity,transform]"
        :class="[open ? '' : '-rotate-90', open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100']"
      />
    </button>
    <div
      v-if="open"
      class="my-1 ml-6 overflow-x-auto rounded-md border border-muted"
      style="background: var(--surface-muted)"
    >
      <template v-if="item.diff">
        <p class="k-mono border-b border-muted px-3 py-1.5 text-2xs text-dimmed">
          {{ item.diff.path }}
        </p>
        <pre class="k-mono px-3 py-2 text-xs leading-relaxed"><span
          v-for="(line, i) in diffLines"
          :key="i"
          class="block"
          :style="line.type === 'added' ? 'color: var(--text-primary)' : line.type === 'removed' ? 'color: var(--status-error)' : 'color: var(--text-dimmed)'"
        >{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }} {{ line.text }}</span></pre>
      </template>
      <pre
        v-else
        class="k-mono max-h-80 overflow-y-auto whitespace-pre-wrap wrap-break-word px-3 py-2 text-xs leading-relaxed text-muted"
      >{{ item.output }}</pre>
    </div>
  </div>
</template>
