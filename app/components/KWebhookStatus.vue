<script setup lang="ts">
import type { WebhookConnection } from '~/composables/useIntegrationConnection'

const props = defineProps<{
  name: string
  connection: WebhookConnection
  setupUrl: string
  rejectCopy: Record<NonNullable<WebhookConnection['lastRejected']>['reason'], string>
  eventCopy: Record<string, string>
  // Set when the tool mints the secret and the admin pastes it here; without it Knecht's own secret is shown to copy.
  saveSecret?: (secret: string) => Promise<void>
}>()

const toast = useToast()

function humanSummary(summary: string): string {
  const [event, key] = summary.split(' ')
  return `${props.eventCopy[event ?? ''] ?? event} ${key ?? ''}`.trim()
}

const state = computed(() => {
  const c = props.connection
  if (!c.webhookSecret) return { tone: 'waiting' as const, text: `Create the webhook in ${props.name} and paste its secret below` }
  const rejected = c.lastRejected
  const delivered = c.lastDelivery
  if (rejected && (!delivered || rejected.at > delivered.at)) {
    return { tone: 'error' as const, text: `${props.name} sent a delivery ${timeAgo(rejected.at)} ${props.rejectCopy[rejected.reason]}` }
  }
  if (delivered) return { tone: 'ok' as const, text: `Receiving events · ${humanSummary(delivered.summary)}, ${timeAgo(delivered.at)}` }
  return { tone: 'waiting' as const, text: `Waiting for ${props.name}` }
})
const detailsOpen = ref(false)
const showDetails = computed(() => state.value.tone !== 'ok' || detailsOpen.value)

async function copy(label: string, text: string | null) {
  if (!text) return
  try {
    await copyText(text)
    toast.add({ title: `${label} copied`, color: 'success' })
  }
  catch {
    toast.add({ title: `Could not copy the ${label.toLowerCase()}`, color: 'error' })
  }
}

const secretShown = ref(false)
const secretEditing = ref(false)
const secretDraft = ref('')
const secretError = ref('')
const secretSaving = ref(false)
async function submitSecret() {
  secretError.value = ''
  if (!secretDraft.value.trim()) {
    secretError.value = 'Paste the secret of the webhook.'
    return
  }
  secretSaving.value = true
  try {
    await props.saveSecret!(secretDraft.value.trim())
    secretDraft.value = ''
    secretEditing.value = false
    toast.add({ title: 'Webhook secret saved', color: 'success' })
  }
  catch (e) {
    secretError.value = errMsg(e, 'Could not save the secret.')
  }
  finally {
    secretSaving.value = false
  }
}
</script>

<template>
  <div class="mt-6 rounded-md border border-muted bg-(--surface-muted) px-4 py-3.5">
    <div class="flex flex-wrap items-center gap-3">
      <KStatusDot
        :color="state.tone === 'error' ? 'error' : state.tone === 'ok' ? 'primary' : 'neutral'"
        :pulse="state.tone === 'waiting'"
        :size="7"
      />
      <span
        class="min-w-0 flex-1 text-2sm"
        :class="state.tone === 'error' ? 'text-error' : 'text-highlighted'"
      >{{ state.text }}</span>
      <UButton
        v-if="state.tone === 'ok'"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="detailsOpen ? 'Hide webhook' : 'Show webhook'"
        @click="() => { detailsOpen = !detailsOpen }"
      />
      <UButton
        v-else
        :to="setupUrl"
        target="_blank"
        color="primary"
        size="sm"
        icon="i-lucide-external-link"
        :label="`Set up in ${name}`"
      />
    </div>

    <div
      v-if="showDetails"
      class="mt-3 border-t border-muted pt-3"
    >
      <p
        v-if="state.tone !== 'ok'"
        class="mb-3 max-w-3xl text-2xs leading-relaxed text-muted"
      >
        <slot name="instructions" />
      </p>
      <div class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">URL</span>
        <span class="k-code min-w-0 max-w-full justify-self-start truncate text-xs">{{ connection.webhookUrl }}</span>
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-copy"
          class="justify-self-end"
          aria-label="Copy webhook URL"
          @click="copy('Webhook URL', connection.webhookUrl)"
        />
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Secret</span>
        <template v-if="connection.webhookSecret && !secretEditing">
          <span class="k-code min-w-0 max-w-full justify-self-start truncate text-xs">{{ secretShown ? connection.webhookSecret : '•'.repeat(24) }}</span>
          <span class="flex gap-1">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              :icon="secretShown ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :aria-label="secretShown ? 'Hide secret' : 'Reveal secret'"
              @click="() => { secretShown = !secretShown }"
            />
            <UButton
              v-if="saveSecret"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-pencil"
              aria-label="Replace webhook secret"
              @click="() => { secretEditing = true }"
            />
            <UButton
              v-else
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-copy"
              aria-label="Copy webhook secret"
              @click="copy('Webhook secret', connection.webhookSecret)"
            />
          </span>
        </template>
        <template v-else>
          <UInput
            v-model="secretDraft"
            type="password"
            size="sm"
            :color="secretError ? 'error' : undefined"
            :highlight="!!secretError"
            class="w-full max-w-md"
            @keydown.enter.prevent="submitSecret"
          />
          <span class="flex gap-1 justify-self-end">
            <UButton
              v-if="secretEditing"
              color="neutral"
              variant="ghost"
              size="xs"
              label="Cancel"
              @click="() => { secretEditing = false; secretDraft = ''; secretError = '' }"
            />
            <UButton
              color="primary"
              size="xs"
              label="Save"
              :loading="secretSaving"
              @click="submitSecret"
            />
          </span>
        </template>
      </div>
      <p
        v-if="secretError"
        class="mt-2 text-xs leading-normal text-error"
      >
        {{ secretError }}
      </p>
    </div>
  </div>
</template>
