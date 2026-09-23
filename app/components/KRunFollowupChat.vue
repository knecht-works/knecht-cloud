<script setup lang="ts">
import { CHAT_COMMANDS, CLEAR_COMMAND, COMPACT_COMMAND } from '#shared/utils/followup'
import type { EnvState } from '#shared/utils/run'
import type { RunStatus } from '~/utils/dashboard'
import type { ChatRun, ChatTurn } from '~/composables/useSessionTranscript'
import { chatTimestamp, copyToClipboard, displayPrompt, recallPrompt } from '~/utils/chat'

const props = defineProps<{
  runId: number
  sessionId: number
  status: RunStatus
  kind: 'workflow' | 'mention'
  envState: EnvState
}>()

const emit = defineEmits<{
  changed: []
}>()

const toastError = useToastError()
const toast = useToast()

const { runs, turns, active, refresh, send, unqueue, retry, stop } = useSessionTranscript(props.sessionId, () => props.runId)

const activeModel = defineModel<boolean>('active', { default: false })
watch(active, (v, was) => {
  activeModel.value = v
  // A finished turn may have moved the branch or opened a PR.
  if (was && !v) emit('changed')
}, { immediate: true })
watch(() => props.status, () => refresh())

const runPending = computed(() => isLiveStatus(props.status))
// A cancelled workflow run must be retried first; a cancelled mention is just a turn that ended.
const cancelledWorkflow = computed(() => props.status === 'cancelled' && props.kind !== 'mention')
const canFollowup = computed(() =>
  !cancelledWorkflow.value && (runPending.value || props.envState !== 'down'))
const followupHint = computed(() => {
  if (props.envState === 'stopped') return 'The environment is stopped. Sending a message boots it again, so the first reply takes a few seconds longer.'
  if (props.envState === 'archived') return 'The environment is archived. Sending a message restores it, so the first reply takes a few minutes longer.'
  return null
})
const blockedHint = computed(() => {
  if (cancelledWorkflow.value) return 'This run was cancelled. Retry it to continue the conversation.'
  return 'The environment is gone. Run the workflow again to continue the conversation.'
})

const { data: settings } = useSettings()
const aiConfigured = computed(() => !!settings.value?.aiKeyConfigured)
const promptDisabled = computed(() => !aiConfigured.value || !canFollowup.value)

const { data: members } = useFetch('/api/members', { key: 'members', lazy: true, default: () => [] })
// Mentions carry a display name, not a login: those fall back to initials.
function authorAvatar(turn: ChatTurn) {
  const login = turn.requestedBy ?? ''
  const member = members.value.find(m => m.login === login.toLowerCase())
  return { src: member?.avatarUrl ?? undefined, alt: member?.name || login || 'You' }
}

type Entry = { key: string, at: number, order: number } & ({ kind: 'run', run: ChatRun } | { kind: 'turn', turn: ChatTurn })
// /clear and /compact empty the window: only what came after the last one is shown, the rows stay in the DB.
const entries = computed<Entry[]>(() => {
  const at = (v: string) => new Date(v).getTime()
  const list: Entry[] = [
    ...runs.value.filter(r => r.kind === 'workflow').map(r => ({ key: `run-${r.id}`, kind: 'run' as const, run: r, at: at(r.createdAt), order: 0 })),
    ...turns.value.map(t => ({ key: t.key ?? `turn-${t.id}`, kind: 'turn' as const, turn: t, at: at(t.createdAt), order: 1 })),
  ].sort((a, b) => a.at - b.at || a.order - b.order)
  const cleared = list.findLastIndex(e => e.kind === 'turn' && e.turn.prompt === CLEAR_COMMAND)
  const compacted = list.findLastIndex(e => e.kind === 'turn' && e.turn.prompt === COMPACT_COMMAND)
  // The compact turn itself stays: its divider marks the cut.
  return list.slice(Math.max(cleared + 1, compacted))
})
const visibleTurns = computed(() => entries.value.filter(e => e.kind === 'turn').length)

// The ring reads the newest usage report of the current conversation; /clear and /compact start it over.
const contextUsage = computed(() => {
  for (const entry of [...entries.value].reverse()) {
    if (entry.kind !== 'turn') continue
    const usage = [...entry.turn.items].reverse().find(i => i.type === 'usage' && i.tokens)
    if (usage?.tokens) return { ...usage.tokens, cost: usage.cost }
  }
  return null
})

// Only the status matters to UChatMessages here: the list itself is rendered below.
const chatMessages = computed(() => turns.value.map(t => ({ id: `turn-${t.id}`, role: 'user' as const, parts: [{ type: 'text' as const, text: t.prompt }] })))
const chatStatus = computed(() => active.value ? 'streaming' as const : 'ready' as const)

const listEl = ref<HTMLElement | null>(null)
function scrollToBottom() {
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight }))
}

const prompt = ref('')
const promptRef = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null)
function focusPrompt() {
  promptRef.value?.textareaRef?.focus()
}

const MODEL_KEY = 'knecht.chat.model'
const model = ref<string | null>(null)
onMounted(() => {
  try {
    model.value = localStorage.getItem(MODEL_KEY)
  }
  catch {
    // Storage blocked: the default model is used.
  }
})
watch(model, (v) => {
  try {
    if (v) localStorage.setItem(MODEL_KEY, v)
    else localStorage.removeItem(MODEL_KEY)
  }
  catch {
    // Storage blocked: the choice lasts for this view only.
  }
})

const files = ref<File[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
function addFiles(list: Iterable<File>) {
  for (const file of list) {
    if (!files.value.some(f => f.name === file.name && f.size === file.size)) files.value.push(file)
  }
}
function removeFile(i: number) {
  files.value.splice(i, 1)
}
const previews = new Map<File, string>()
function attachmentPreview(file: File): string | undefined {
  if (!file.type.startsWith('image/')) return undefined
  let url = previews.get(file)
  if (!url) {
    url = URL.createObjectURL(file)
    previews.set(file, url)
  }
  return url
}
watch(files, (current) => {
  for (const [file, url] of previews) {
    if (!current.includes(file)) {
      URL.revokeObjectURL(url)
      previews.delete(file)
    }
  }
}, { deep: true })
onUnmounted(() => {
  for (const url of previews.values()) URL.revokeObjectURL(url)
})
function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement
  addFiles(input.files ?? [])
  input.value = ''
}
function onPaste(e: ClipboardEvent) {
  const pasted = [...(e.clipboardData?.files ?? [])]
  if (!pasted.length) return
  e.preventDefault()
  addFiles(pasted)
}
async function submit(text: string) {
  const value = text.trim()
  if (!value || promptDisabled.value) return
  const attached = value.startsWith('/') ? [] : files.value
  prompt.value = ''
  files.value = []
  scrollToBottom()
  try {
    await send(value, model.value ? { model: model.value } : {}, attached)
  }
  catch (e) {
    toastError('Send failed', e)
  }
}

const stopping = ref(false)
async function stopTurn() {
  if (stopping.value) return
  stopping.value = true
  try {
    await stop()
  }
  catch (e) {
    toastError('Stop failed', e)
  }
  finally {
    stopping.value = false
  }
}

async function retryTurn(turn: ChatTurn) {
  try {
    await retry(turn.id)
  }
  catch (e) {
    toastError('Retry failed', e)
  }
}

async function removeQueued(turn: ChatTurn) {
  try {
    await unqueue(turn.id)
  }
  catch (e) {
    toastError('Could not remove the message', e)
  }
}

async function copyText(text: string) {
  try {
    await copyToClipboard(text)
    toast.add({ title: 'Copied', duration: 1500 })
  }
  catch (e) {
    toast.add({ title: 'Copy failed', description: (e as Error).message, color: 'error' })
  }
}

function userActions(turn: ChatTurn) {
  if (turn.prompt === CLEAR_COMMAND || turn.prompt === COMPACT_COMMAND) return undefined
  if (isWaiting(turn)) {
    return [
      { icon: 'i-lucide-copy', label: 'Copy', onClick: () => copyText(displayPrompt(turn.prompt)) },
      { icon: 'i-lucide-pencil', label: 'Edit', onClick: async () => {
        await removeQueued(turn)
        prompt.value = recallPrompt(turn.prompt)
        focusPrompt()
      } },
      { icon: 'i-lucide-trash-2', label: 'Delete', onClick: () => removeQueued(turn) },
    ]
  }
  return [
    { icon: 'i-lucide-copy', label: 'Copy', onClick: () => copyText(displayPrompt(turn.prompt)) },
    { icon: 'i-lucide-pencil', label: 'Edit and resend', onClick: () => {
      prompt.value = recallPrompt(turn.prompt)
      focusPrompt()
    } },
    { icon: 'i-lucide-rotate-ccw', label: 'Resend', onClick: () => submit(recallPrompt(turn.prompt)) },
  ]
}

function replyText(turn: ChatTurn): string {
  return turn.items.filter(i => i.type === 'message').map(i => i.text).join('\n\n').trim()
}

function assistantActions(turn: ChatTurn) {
  const text = replyText(turn)
  const actions = [
    ...(text ? [{ icon: 'i-lucide-copy', label: 'Copy reply', onClick: () => copyText(text) }] : []),
    ...(turn.status === 'failed' && !turn.optimistic ? [{ icon: 'i-lucide-rotate-ccw', label: 'Retry', onClick: () => retryTurn(turn) }] : []),
  ]
  return actions.length ? actions : undefined
}

// A turn only "waits" behind another active one; a fresh send looks like it started right away.
function isWaiting(turn: ChatTurn): boolean {
  return turn.status === 'queued' && !turn.optimistic && turns.value.some(t => t.id !== turn.id && t.id < turn.id && isTurnActive(t))
}

function showsReply(turn: ChatTurn): boolean {
  return !isWaiting(turn) && !(turn.optimistic && turn.status === 'failed')
}

const commandQuery = computed(() => /^\/\S*$/.test(prompt.value) ? prompt.value : null)
// Esc hides the palette for the current input; typing brings it back.
const commandsDismissed = ref(false)
const commandMatches = computed(() => commandQuery.value === null || commandsDismissed.value
  ? []
  : CHAT_COMMANDS.filter(c => c.name.startsWith(commandQuery.value!)))
const commandIndex = ref(0)
watch(commandMatches, () => {
  commandIndex.value = 0
})
watch(prompt, () => {
  commandsDismissed.value = false
})

function pickCommand(name: string) {
  prompt.value = name
  focusPrompt()
}

function lastOwnPrompt(): string | null {
  const turn = [...turns.value].reverse().find(t => t.origin === 'dashboard' && t.prompt !== CLEAR_COMMAND)
  return turn ? recallPrompt(turn.prompt) : null
}

// Runs in the capture phase so the prompt's own Enter and Esc handlers see nothing.
function onPromptKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && commandMatches.value.length) {
    e.preventDefault()
    e.stopPropagation()
    commandsDismissed.value = true
    return
  }
  if (e.key === 'Escape' && active.value) {
    e.preventDefault()
    e.stopPropagation()
    stopTurn()
    return
  }
  const matches = commandMatches.value
  if (matches.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      commandIndex.value = (commandIndex.value + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length
      return
    }
    const picked = matches[commandIndex.value]
    if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey && picked && prompt.value !== picked.name) {
      e.preventDefault()
      e.stopPropagation()
      prompt.value = picked.name
      return
    }
  }
  if (e.key === 'ArrowUp' && !prompt.value) {
    const last = lastOwnPrompt()
    if (last) {
      e.preventDefault()
      prompt.value = last
    }
  }
}

function onWindowKeydown(e: KeyboardEvent) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  e.preventDefault()
  focusPrompt()
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onUnmounted(() => window.removeEventListener('keydown', onWindowKeydown))
</script>

<template>
  <KPanel
    title="Follow-up"
    icon="i-lucide-message-circle-reply"
    accent="var(--accent-orange)"
    :pad="0"
  >
    <div class="flex h-[70vh] flex-col">
      <div
        v-if="visibleTurns"
        ref="listEl"
        class="min-h-0 flex-1 overflow-y-auto px-5 pt-3.5 pb-4"
      >
        <UChatMessages
          :messages="chatMessages"
          :status="chatStatus"
          should-auto-scroll
        >
          <template
            v-for="entry in entries"
            :key="entry.key"
          >
            <ChatDivider v-if="entry.kind === 'run'">
              <KStatusDot
                :color="RUN_STATUS_META[entry.run.status].dot"
                :pulse="RUN_STATUS_META[entry.run.status].pulse"
                :glow="false"
                :size="5"
              />
              <NuxtLink
                :to="{ query: { run: String(entry.run.id) } }"
                replace
                class="k-mono truncate transition-colors hover:text-muted"
              >{{ entry.run.workflow }} #{{ entry.run.id }}</NuxtLink>
              <span>· {{ RUN_STATUS_META[entry.run.status].label.toLowerCase() }} · {{ timeAgo(entry.run.createdAt) }}</span>
            </ChatDivider>
            <template v-else-if="entry.turn.prompt === CLEAR_COMMAND || entry.turn.prompt === COMPACT_COMMAND">
              <KChatTranscript :turn="entry.turn" />
            </template>
            <template v-else>
              <UChatMessage
                :id="`user-${entry.turn.id}`"
                role="user"
                side="right"
                variant="soft"
                :avatar="authorAvatar(entry.turn)"
                :parts="[{ type: 'text', text: entry.turn.prompt }]"
                :actions="userActions(entry.turn)"
                :ui="{ content: 'space-y-0', container: 'flex-row-reverse justify-start' }"
              >
                <template #content>
                  <p class="whitespace-pre-wrap">
                    {{ displayPrompt(entry.turn.prompt) }}
                  </p>
                  <div class="mt-1.5 flex items-center justify-end gap-1.5 text-3xs text-dimmed">
                    <UIcon
                      v-if="entry.turn.origin === 'mention'"
                      name="i-lucide-at-sign"
                      class="size-3"
                    />
                    <span class="k-mono">{{ chatTimestamp(entry.turn.createdAt) }}</span>
                    <template v-if="entry.turn.optimistic && entry.turn.status === 'failed'">
                      <span
                        class="k-mono"
                        style="color: var(--status-error)"
                      >· not sent</span>
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-rotate-ccw"
                        aria-label="Send again"
                        @click="removeQueued(entry.turn); submit(recallPrompt(entry.turn.prompt))"
                      />
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-x"
                        aria-label="Dismiss"
                        @click="removeQueued(entry.turn)"
                      />
                    </template>
                  </div>
                  <div
                    v-if="entry.turn.attachments.length"
                    class="mt-2 flex flex-wrap justify-end gap-1.5"
                  >
                    <a
                      v-for="a in entry.turn.attachments"
                      :key="a.name"
                      :href="entry.turn.optimistic ? undefined : `/api/followups/${entry.turn.id}/attachments/${encodeURIComponent(a.name)}`"
                      target="_blank"
                      class="flex items-center gap-1.5 rounded-md border border-muted px-2 py-1 text-2xs text-muted"
                      :class="entry.turn.optimistic ? '' : 'hover:text-highlighted'"
                    >
                      <img
                        v-if="a.type.startsWith('image/') && !entry.turn.optimistic"
                        :src="`/api/followups/${entry.turn.id}/attachments/${encodeURIComponent(a.name)}`"
                        :alt="a.name"
                        class="size-8 rounded object-cover"
                      >
                      <UIcon
                        v-else
                        name="i-lucide-file"
                        class="size-3.5"
                      />
                      <span class="k-mono max-w-40 truncate">{{ a.name }}</span>
                    </a>
                  </div>
                </template>
              </UChatMessage>
              <UChatMessage
                v-if="showsReply(entry.turn)"
                :id="`reply-${entry.turn.id}`"
                role="assistant"
                side="left"
                variant="naked"
                :avatar="{ src: '/mascot/knecht-avatar.svg', alt: 'Knecht' }"
                :parts="[{ type: 'text', text: '' }]"
                :actions="assistantActions(entry.turn)"
              >
                <template #content>
                  <KChatTranscript :turn="entry.turn" />
                </template>
              </UChatMessage>
            </template>
          </template>
        </UChatMessages>
      </div>
      <div
        v-else
        class="flex flex-1 flex-col items-center justify-center gap-3 px-5 pt-3.5 pb-4 text-center"
      >
        <img
          src="/mascot/mascotRight.png"
          alt="Knecht"
          class="h-24 w-auto drop-shadow-mascot"
        >
        <p class="max-w-80 text-2sm text-muted">
          Nothing here yet. Ask the agent to tweak the result, or type / for commands.
        </p>
      </div>
      <div class="px-5 pb-3.5">
        <div
          v-if="!canFollowup || !aiConfigured || followupHint"
          class="mb-3 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-2sm text-highlighted"
          style="border-color: color-mix(in oklab, var(--status-orange) 40%, transparent); background: color-mix(in oklab, var(--status-orange) 10%, transparent)"
        >
          <UIcon
            name="i-lucide-triangle-alert"
            class="size-4 flex-none"
            :style="{ color: 'var(--status-orange)' }"
          />
          <span>
            <template v-if="!canFollowup">
              {{ blockedHint }}
            </template>
            <template v-else-if="!aiConfigured">
              Add your AI provider key under
              <NuxtLink
                to="/settings/agent"
                class="underline underline-offset-2"
              >Settings → Agent</NuxtLink>
              first.
            </template>
            <template v-else>
              {{ followupHint }}
            </template>
          </span>
        </div>
        <!-- No autofocus (Nuxt UI defaults it on): stealing focus scrolls the page away from the preview above. -->
        <div
          class="relative"
          @keydown.capture="onPromptKeydown"
          @paste="onPaste"
        >
          <ul
            v-if="commandMatches.length"
            class="k-card absolute inset-x-0 bottom-full z-10 mb-2 flex flex-col p-1"
          >
            <li
              v-for="(command, i) in commandMatches"
              :key="command.name"
            >
              <button
                type="button"
                class="flex w-full cursor-pointer items-baseline gap-3 rounded-md px-2 py-1.5 text-left"
                :class="i === commandIndex ? 'bg-elevated/60' : ''"
                @mouseenter="commandIndex = i"
                @click="pickCommand(command.name)"
              >
                <span class="k-mono text-xs text-highlighted">{{ command.name }}</span>
                <span class="min-w-0 truncate text-2xs text-dimmed">{{ command.description }}</span>
              </button>
            </li>
          </ul>
          <UChatPrompt
            ref="promptRef"
            v-model="prompt"
            class="w-full"
            :ui="{ root: 'gap-0' }"
            :autofocus="false"
            placeholder="Message the agent, or type / for commands"
            :rows="2"
            :maxrows="8"
            :disabled="promptDisabled"
            @submit="submit(prompt)"
          >
            <template
              v-if="files.length"
              #header
            >
              <div class="flex flex-wrap items-center gap-1.5">
                <UButton
                  v-for="(file, i) in files"
                  :key="`${file.name}-${file.size}`"
                  :label="file.name"
                  :avatar="attachmentPreview(file) ? { src: attachmentPreview(file) } : undefined"
                  :icon="attachmentPreview(file) ? undefined : 'i-lucide-file'"
                  color="neutral"
                  variant="soft"
                  size="xs"
                  trailing-icon="i-lucide-x"
                  :ui="{ label: 'k-mono max-w-48 truncate' }"
                  @click="removeFile(i)"
                />
              </div>
            </template>
            <template #footer>
              <div class="flex items-center gap-0.5">
                <UTooltip text="Attach files (or paste them)">
                  <UButton
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="Attach files"
                    :disabled="promptDisabled"
                    @click="fileInput?.click()"
                  />
                </UTooltip>
                <input
                  ref="fileInput"
                  type="file"
                  multiple
                  class="hidden"
                  @change="onFilesPicked"
                >
                <ChatContextRing
                  :usage="contextUsage"
                  @compact="submit(COMPACT_COMMAND)"
                />
              </div>
              <div class="flex items-center gap-1.5">
                <ChatModelPicker v-model="model" />
                <UChatPromptSubmit
                  color="primary"
                  size="sm"
                  :status="chatStatus"
                  :disabled="promptDisabled || !prompt.trim()"
                  @stop="stopTurn"
                />
              </div>
            </template>
          </UChatPrompt>
        </div>
      </div>
    </div>
  </KPanel>
</template>
