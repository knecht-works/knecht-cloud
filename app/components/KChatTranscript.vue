<script setup lang="ts">
import type { ChatItem, ChatTurn } from '~/composables/useSessionTranscript'
import { replyActivity, replyItems } from '~/utils/chat-activity'
import { computed, provide, ref } from 'vue'
import { CHAT_SESSION_ID } from '~/utils/chat'
import ChatComark from '~/components/chat/Comark'
import ChatDivider from '~/components/chat/Divider.vue'
import ChatToolRow from '~/components/chat/ToolRow.vue'
import ChatIndicator from '~/components/chat/Indicator.vue'
import ChatAgentImages from '~/components/chat/AgentImages.vue'
import { agentImageFile, agentImageFiles } from '#shared/utils/agent-images'
import { UIcon } from '#components'

const props = defineProps<{ turns: ChatTurn[], sessionId: number }>()

provide(CHAT_SESSION_ID, props.sessionId)

type Block = { kind: 'item', item: ChatItem } | { kind: 'tools', items: ChatItem[], images: string[] }

// Consecutive tool calls fold into one line; a message or divider between them starts a new group.
const blocks = computed<Block[]>(() => {
  const out: Block[] = []
  for (const item of replyItems(props.turns)) {
    if (item.type === 'usage') continue
    const last = out.at(-1)
    const groups = item.type === 'tool' && item.kind !== 'preview'
    if (groups && last?.kind === 'tools' && last.items[0]!.kind !== 'preview') last.items.push(item)
    else if (item.type === 'tool') out.push({ kind: 'tools', items: [item], images: [] })
    else out.push({ kind: 'item', item })
  }
  for (const block of out) {
    if (block.kind === 'tools') block.images = [...new Set(block.items.flatMap(screenshots))]
  }
  return out
})

// A completed tool's output never changes; the transcript re-renders on every streamed chunk.
const screenshotCache = new Map<number, string[]>()
function screenshots(item: ChatItem): string[] {
  if (item.status !== 'completed') return []
  let files = screenshotCache.get(item.id)
  if (!files) {
    const viewed = item.kind === 'read' ? (item.locations ?? []).map(agentImageFile).filter(f => f !== null) : []
    screenshotCache.set(item.id, files = [...agentImageFiles(item.output), ...viewed])
  }
  return files
}

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
  const turn = props.turns.at(-1)
  if (turn?.status !== 'failed') return null
  if (turn.error === 'Cancelled') return { text: 'Cancelled', color: 'var(--text-dimmed)' }
  const text = turn.error?.trim() || 'Follow-up failed'
  return { text: text.charAt(0).toUpperCase() + text.slice(1), color: 'var(--status-error)' }
})
const activity = computed(() => replyActivity(props.turns))
</script>

<template>
  <!-- pt-1: the 24px rows then centre on the 32px avatar next to them. -->
  <div class="flex flex-col gap-2 pt-1">
    <template
      v-for="block in blocks"
      :key="block.kind === 'item' ? block.item.id : block.items[0]!.id"
    >
      <template v-if="block.kind === 'item'">
        <ChatComark
          v-if="block.item.type === 'message'"
          :markdown="block.item.text"
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
      <ChatAgentImages
        v-if="block.kind === 'tools' && block.images.length"
        :session-id="sessionId"
        :files="block.images"
      />
    </template>
    <div
      v-if="failure"
      class="flex min-h-6 items-center gap-2"
    >
      <span :style="{ color: failure.color }">{{ failure.text }}</span>
    </div>
    <ChatIndicator
      v-else-if="activity"
      :text="activity"
    />
  </div>
</template>
