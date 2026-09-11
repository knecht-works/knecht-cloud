<script setup lang="ts">
import { PUBLISH_FOLLOWUP_PROMPT } from '#shared/utils/followup'
import type { EnvState } from '#shared/utils/run'
import type { RunStatus } from '~/utils/dashboard'

const props = defineProps<{
  runId: number
  status: RunStatus
  envState: EnvState
  prUrl: string | null
}>()

const emit = defineEmits<{
  changed: []
}>()

const toastError = useToastError()

const { data: followups, refresh: refreshFollowups } = useFetch(`/api/runs/${props.runId}/followups`, { lazy: true })

const followupActive = computed(() =>
  (followups.value ?? []).some(f => f.status === 'queued' || f.status === 'running'))
const active = defineModel<boolean>('active', { default: false })
watch(followupActive, (v) => {
  active.value = v
}, { immediate: true })

usePollWhile(() => followupActive.value, refreshFollowups)

const canFollowup = computed(() =>
  (props.status === 'success' || props.status === 'failed') && props.envState !== 'down')
const followupHint = computed(() => {
  if (props.envState === 'stopped') return 'The environment reboots first (a few seconds).'
  if (props.envState === 'archived') return 'The environment is restored first (a few minutes).'
  return null
})

const { data: settings } = useSettings()
const aiConfigured = computed(() => !!settings.value?.aiKeyConfigured)

const followupPrompt = ref('')
const sendingFollowup = ref(false)
const followupLocked = computed(() => !aiConfigured.value || followupActive.value || sendingFollowup.value)
async function sendFollowup(prompt: string) {
  const text = prompt.trim()
  if (!text || sendingFollowup.value) return
  sendingFollowup.value = true
  try {
    await $fetch(`/api/runs/${props.runId}/followups`, { method: 'POST', body: { prompt: text } })
    followupPrompt.value = ''
    await refreshFollowups()
    emit('changed')
  }
  catch (e) {
    toastError('Follow-up failed', e)
  }
  finally {
    sendingFollowup.value = false
  }
}

const stoppingFollowup = ref(false)
async function stopFollowup() {
  if (stoppingFollowup.value) return
  stoppingFollowup.value = true
  try {
    await $fetch(`/api/runs/${props.runId}/followups/cancel`, { method: 'POST' })
    await refreshFollowups()
    emit('changed')
  }
  catch (e) {
    toastError('Stop failed', e)
  }
  finally {
    stoppingFollowup.value = false
  }
}

type ChatMessage = { id: string, role: 'user' | 'assistant', parts: { type: 'text', text: string }[] }
const chatMessages = computed<ChatMessage[]>(() => (followups.value ?? []).flatMap((f) => {
  const messages: ChatMessage[] = [{
    id: `followup-${f.id}-prompt`,
    role: 'user',
    parts: [{ type: 'text', text: f.prompt === PUBLISH_FOLLOWUP_PROMPT ? 'Open a PR' : f.prompt }],
  }]
  const reply = f.status === 'failed'
    ? `✗ ${f.error ?? 'Follow-up failed'}`
    // eslint-disable-next-line no-control-regex
    : f.status === 'success' ? (f.response ?? 'Done.').replace(/\u001B\[[0-9;]*m/g, '') : null
  if (reply) {
    messages.push({ id: `followup-${f.id}-reply`, role: 'assistant', parts: [{ type: 'text', text: reply }] })
  }
  return messages
}))
const chatStatus = computed(() => followupActive.value ? 'submitted' as const : 'ready' as const)

function messageText(message: { parts: { type: string, text?: string }[] }): string {
  return message.parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('')
}

const publishable = computed(() => canFollowup.value && !props.prUrl)
</script>

<template>
  <KPanel
    v-if="canFollowup"
    title="Follow-up"
    icon="i-lucide-message-circle-reply"
  >
    <p class="mb-3 text-2sm text-muted">
      Tell the agent what to tweak: it continues this run's session in the
      run's own environment.
      <span v-if="!aiConfigured">
        Add your AI provider key under
        <NuxtLink
          to="/settings/agent"
          class="text-toned underline underline-offset-2"
        >Settings → Agent</NuxtLink>
        first.
      </span>
      <span v-else-if="followupHint"> {{ followupHint }}</span>
    </p>
    <div
      v-if="chatMessages.length || followupActive"
      class="mb-4 max-h-100 overflow-y-auto"
    >
      <UChatMessages
        :messages="chatMessages"
        :status="chatStatus"
        should-auto-scroll
        :assistant="{ avatar: { src: '/mascot/knecht-avatar.svg', alt: 'Knecht' } }"
      >
        <template #content="{ message }">
          <ChatComark
            v-if="message.role === 'assistant'"
            :markdown="messageText(message)"
          />
          <p
            v-else
            class="whitespace-pre-wrap"
          >
            {{ messageText(message) }}
          </p>
        </template>
      </UChatMessages>
    </div>
    <div
      v-if="publishable"
      class="mb-2"
    >
      <UButton
        color="neutral"
        variant="outline"
        size="xs"
        class="rounded-full"
        icon="i-lucide-git-pull-request"
        label="Open a PR"
        :disabled="followupLocked"
        @click="sendFollowup(PUBLISH_FOLLOWUP_PROMPT)"
      />
    </div>
    <!-- No autofocus (Nuxt UI defaults it on): stealing focus scrolls the page away from the preview above. -->
    <UChatPrompt
      v-model="followupPrompt"
      :autofocus="false"
      placeholder="e.g. The button label should say 'Save changes' instead"
      :disabled="followupLocked"
      @submit="sendFollowup(followupPrompt)"
    >
      <UChatPromptSubmit
        color="primary"
        :status="chatStatus"
        :disabled="followupLocked || !followupPrompt.trim()"
        @stop="stopFollowup"
      />
    </UChatPrompt>
  </KPanel>
</template>
