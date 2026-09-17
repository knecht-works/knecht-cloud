<script setup lang="ts">
import type { ChatItem, ChatTurn } from '~/composables/useSessionTranscript'

const props = defineProps<{ turn: ChatTurn }>()

type Block = { kind: 'item', item: ChatItem } | { kind: 'tools', items: ChatItem[] }

// Consecutive tool calls fold into one line; a message or divider between them starts a new group.
const blocks = computed<Block[]>(() => {
  const out: Block[] = []
  for (const item of props.turn.items) {
    if (item.type === 'usage') continue
    const last = out.at(-1)
    if (item.type === 'tool' && last?.kind === 'tools') last.items.push(item)
    else if (item.type === 'tool') out.push({ kind: 'tools', items: [item] })
    else out.push({ kind: 'item', item })
  }
  return out
})

const openGroups = ref(new Set<number>())
function toggleGroup(id: number) {
  const next = new Set(openGroups.value)
  if (!next.delete(id)) next.add(id)
  openGroups.value = next
}

function groupSummary(items: ChatItem[]): string {
  const files = new Set(items.map(i => i.diff?.path).filter(Boolean))
  const calls = `${items.length} tool calls`
  return files.size ? `${calls}, ${files.size} ${files.size === 1 ? 'file' : 'files'} changed` : calls
}

function groupStatus(items: ChatItem[]): ChatItem['status'] {
  if (items.some(i => i.status === 'failed')) return 'failed'
  if (items.some(i => i.status === 'pending' || i.status === 'in_progress')) return 'in_progress'
  return 'completed'
}

function groupCurrent(items: ChatItem[]): string | null {
  return items.find(i => i.status === 'pending' || i.status === 'in_progress')?.text ?? null
}

const failure = computed(() => {
  if (props.turn.status !== 'failed') return null
  if (props.turn.error === 'Cancelled') return { text: 'Cancelled', color: 'var(--text-dimmed)' }
  const text = props.turn.error?.trim() || 'Follow-up failed'
  return { text: text.charAt(0).toUpperCase() + text.slice(1), color: 'var(--status-error)' }
})
const working = computed(() => (props.turn.status === 'running' || props.turn.status === 'queued') && !props.turn.items.length)
</script>

<template>
  <!-- pt-1: the 24px rows then centre on the 32px avatar next to them. -->
  <div class="flex flex-col gap-1 pt-1">
    <template
      v-for="block in blocks"
      :key="block.kind === 'item' ? block.item.id : block.items[0]!.id"
    >
      <template v-if="block.kind === 'item'">
        <ChatComark
          v-if="block.item.type === 'message'"
          :markdown="block.item.text"
          class="mb-1"
        />
        <ChatDivider v-else-if="block.item.type === 'divider'">
          <UIcon
            name="i-lucide-sparkles"
            class="size-3"
          />
          {{ block.item.text }}
        </ChatDivider>
        <p
          v-else
          class="text-xs text-dimmed"
        >
          {{ block.item.text }}
        </p>
      </template>
      <ChatToolRow
        v-else-if="block.items.length === 1"
        :item="block.items[0]!"
      />
      <div
        v-else
        class="min-w-0"
      >
        <button
          type="button"
          class="flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 text-left text-xs hover:bg-elevated/60"
          @click="toggleGroup(block.items[0]!.id)"
        >
          <span class="flex size-4 flex-none items-center justify-center">
            <UIcon
              v-if="groupStatus(block.items) === 'in_progress'"
              name="i-lucide-loader-circle"
              class="size-3.5 animate-spin text-dimmed"
            />
            <UIcon
              v-else-if="groupStatus(block.items) === 'failed'"
              name="i-lucide-x"
              class="size-3.5"
              style="color: var(--status-error)"
            />
            <UIcon
              v-else
              name="i-lucide-chevron-right"
              class="size-3.5 text-dimmed transition-transform"
              :class="openGroups.has(block.items[0]!.id) ? 'rotate-90' : ''"
            />
          </span>
          <span class="flex-none text-muted">{{ groupSummary(block.items) }}</span>
          <span
            v-if="!openGroups.has(block.items[0]!.id) && groupCurrent(block.items)"
            class="k-mono min-w-0 flex-1 truncate text-dimmed"
          >{{ groupCurrent(block.items) }}</span>
        </button>
        <div
          v-if="openGroups.has(block.items[0]!.id)"
          class="ml-3 flex flex-col border-l border-muted pl-2"
        >
          <ChatToolRow
            v-for="item in block.items"
            :key="item.id"
            :item="item"
          />
        </div>
      </div>
    </template>
    <div
      v-if="failure"
      class="flex min-h-6 items-center gap-2"
    >
      <span :style="{ color: failure.color }">{{ failure.text }}</span>
    </div>
    <ChatIndicator v-else-if="working" />
  </div>
</template>
