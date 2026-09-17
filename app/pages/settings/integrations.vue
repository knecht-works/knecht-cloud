<script setup lang="ts">
const toast = useToast()

interface JiraConnection {
  configured: boolean
  siteUrl: string | null
  email: string | null
  accountName: string | null
  accountId: string | null
  apiTokenPreview: string | null
  webhookUrl: string | null
  webhookSecret: string | null
  webhookEvents: string[]
  lastDelivery: { at: number, summary: string } | null
  lastRejected: { at: number, reason: 'signature' | 'empty-body' | 'no-project' } | null
}
const { data: jira, refresh: refreshJira } = useFetch<JiraConnection>('/api/jira/connection', { lazy: true })

// Jira has no delivery log, so this page is where the admin sees the webhook arrive.
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  poll = setInterval(() => {
    if (jira.value?.configured) void refreshJira()
  }, 5000)
})
onUnmounted(() => clearInterval(poll))

const REJECT_COPY: Record<NonNullable<JiraConnection['lastRejected']>['reason'], string> = {
  'signature': 'with a wrong secret. Paste the secret into the webhook again.',
  'empty-body': 'without a body. Uncheck "Exclude body" in the webhook.',
  'no-project': 'for a Jira project no project is linked to yet.',
}
const EVENT_COPY: Record<string, string> = {
  'jira:issue_created': 'issue created',
  'jira:issue_updated': 'issue updated',
  'jira:issue_deleted': 'issue deleted',
  'comment_created': 'comment on',
}
function humanSummary(summary: string): string {
  const [event, key] = summary.split(' ')
  return `${EVENT_COPY[event ?? ''] ?? event} ${key ?? ''}`.trim()
}
const deliveryState = computed(() => {
  const j = jira.value
  if (!j?.configured) return null
  const rejected = j.lastRejected
  const delivered = j.lastDelivery
  if (rejected && (!delivered || rejected.at > delivered.at)) {
    return { tone: 'error' as const, text: `Jira sent a delivery ${timeAgo(rejected.at)} ${REJECT_COPY[rejected.reason]}` }
  }
  if (delivered) return { tone: 'ok' as const, text: `Receiving events · ${humanSummary(delivered.summary)}, ${timeAgo(delivered.at)}` }
  return { tone: 'waiting' as const, text: 'Waiting for Jira' }
})
const detailsOpen = ref(false)
const showDetails = computed(() => deliveryState.value?.tone !== 'ok' || detailsOpen.value)

const secretShown = ref(false)
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

const siteUrl = ref('')
const email = ref('')
const token = ref('')
watch(jira, (j) => {
  if (!j) return
  siteUrl.value = j.siteUrl ?? ''
  email.value = j.email ?? ''
}, { immediate: true })

const fieldErrors = reactive({ siteUrl: '', email: '', token: '' })
function validate(): boolean {
  fieldErrors.siteUrl = ''
  fieldErrors.email = ''
  fieldErrors.token = ''
  const url = siteUrl.value.trim()
  if (!url) fieldErrors.siteUrl = 'Enter your Jira site URL.'
  else if (!/^https:\/\/[^\s/]+/.test(url)) fieldErrors.siteUrl = 'Must be an https:// URL, e.g. https://acme.atlassian.net.'
  const mail = email.value.trim()
  if (!mail) fieldErrors.email = 'Enter the account\'s email.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) fieldErrors.email = 'That doesn\'t look like an email address.'
  if (!token.value.trim()) fieldErrors.token = 'Paste an API token.'
  return !fieldErrors.siteUrl && !fieldErrors.email && !fieldErrors.token
}

const connectError = ref('')
const connecting = ref(false)
async function connect() {
  connectError.value = ''
  if (!validate()) return
  connecting.value = true
  try {
    jira.value = await $fetch<JiraConnection>('/api/jira/connection', {
      method: 'POST',
      body: { siteUrl: siteUrl.value.trim(), email: email.value.trim(), apiToken: token.value.trim() },
    })
    token.value = ''
    toast.add({ title: `Connected as ${jira.value.accountName}`, color: 'success' })
  }
  catch (e) {
    connectError.value = errMsg(e, 'Could not connect to Jira.')
  }
  finally {
    connecting.value = false
  }
}

const disconnecting = ref(false)
async function disconnect() {
  connectError.value = ''
  disconnecting.value = true
  try {
    jira.value = await $fetch<JiraConnection>('/api/jira/connection', { method: 'DELETE' })
    toast.add({ title: 'Jira disconnected', color: 'success' })
  }
  catch (e) {
    connectError.value = errMsg(e, 'Could not disconnect.')
  }
  finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <KPanel
    title="Jira"
    icon="i-simple-icons-jira"
    :accent="integrationUi('jira').color"
  >
    <template #action>
      <span
        class="k-mono text-2xs"
        :class="jira?.configured ? 'text-primary' : 'text-dimmed'"
      >
        {{ jira ? (jira.configured ? `Connected as ${jira.accountName}` : 'Not connected') : 'Checking…' }}
      </span>
    </template>

    <p class="mb-5 max-w-3xl text-2sm leading-relaxed text-muted">
      Tickets start workflows and get Knecht's replies. Connect with an
      <a
        href="https://id.atlassian.com/manage-profile/security/api-tokens"
        target="_blank"
        class="text-toned underline underline-offset-2"
      >API token</a>, ideally of a dedicated "Knecht" account, then link each project to its Jira project in the project settings.
    </p>

    <form
      class="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1fr_1fr_auto]"
      @submit.prevent="connect"
    >
      <div>
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Site URL</span>
        <UInput
          v-model="siteUrl"
          placeholder="https://acme.atlassian.net"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          :color="fieldErrors.siteUrl ? 'error' : undefined"
          :highlight="!!fieldErrors.siteUrl"
          class="mt-2 w-full"
          :ui="{ base: 'k-mono' }"
        />
        <p
          v-if="fieldErrors.siteUrl"
          class="mt-2 text-xs leading-normal text-error"
        >
          {{ fieldErrors.siteUrl }}
        </p>
      </div>
      <div>
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Email</span>
        <UInput
          v-model="email"
          type="email"
          placeholder="knecht@acme.com"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          :color="fieldErrors.email ? 'error' : undefined"
          :highlight="!!fieldErrors.email"
          class="mt-2 w-full"
        />
        <p
          v-if="fieldErrors.email"
          class="mt-2 text-xs leading-normal text-error"
        >
          {{ fieldErrors.email }}
        </p>
      </div>
      <div>
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">API token</span>
        <UInput
          v-model="token"
          type="password"
          :placeholder="jira?.apiTokenPreview ?? (jira?.configured ? 'Configured, enter a token to replace it' : 'ATATT…')"
          :color="fieldErrors.token ? 'error' : undefined"
          :highlight="!!fieldErrors.token"
          class="mt-2 w-full"
        />
        <p
          v-if="fieldErrors.token"
          class="mt-2 text-xs leading-normal text-error"
        >
          {{ fieldErrors.token }}
        </p>
      </div>
      <div class="flex gap-2 xl:mt-7.5">
        <UButton
          type="submit"
          color="primary"
          :label="jira?.configured ? 'Reconnect' : 'Connect'"
          :loading="connecting"
        />
        <UButton
          v-if="jira?.configured"
          color="neutral"
          variant="outline"
          label="Disconnect"
          :loading="disconnecting"
          @click="disconnect"
        />
      </div>
    </form>

    <p
      v-if="connectError"
      class="mt-4 text-xs leading-normal text-error"
    >
      {{ connectError }}
    </p>

    <div
      v-if="jira?.configured && deliveryState"
      class="mt-6 rounded-md border border-muted bg-(--surface-muted) px-4 py-3.5"
    >
      <div class="flex flex-wrap items-center gap-3">
        <KStatusDot
          :color="deliveryState.tone === 'error' ? 'error' : deliveryState.tone === 'ok' ? 'primary' : 'neutral'"
          :pulse="deliveryState.tone === 'waiting'"
          :size="7"
        />
        <span
          class="min-w-0 flex-1 text-2sm"
          :class="deliveryState.tone === 'error' ? 'text-error' : 'text-highlighted'"
        >{{ deliveryState.text }}</span>
        <UButton
          v-if="deliveryState.tone === 'ok'"
          color="neutral"
          variant="ghost"
          size="sm"
          :label="detailsOpen ? 'Hide webhook' : 'Show webhook'"
          @click="() => { detailsOpen = !detailsOpen }"
        />
        <UButton
          v-else
          :to="`${jira.siteUrl}/plugins/servlet/webhooks`"
          target="_blank"
          color="primary"
          size="sm"
          icon="i-lucide-external-link"
          label="Set up in Jira"
        />
      </div>

      <div
        v-if="showDetails"
        class="mt-3 border-t border-muted pt-3"
      >
        <p
          v-if="deliveryState.tone !== 'ok'"
          class="mb-3 max-w-3xl text-2xs leading-relaxed text-muted"
        >
          Create a webhook in Jira with these two values, tick <span class="text-toned">Issue created, updated, deleted</span>
          and <span class="text-toned">Comment created</span>, and leave "Exclude body" unchecked.
          Then edit any ticket in a linked project.
        </p>
        <div class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
          <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">URL</span>
          <span class="k-code min-w-0 max-w-full justify-self-start truncate text-xs">{{ jira.webhookUrl }}</span>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-copy"
            aria-label="Copy webhook URL"
            @click="copy('Webhook URL', jira.webhookUrl)"
          />
          <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Secret</span>
          <span class="k-code min-w-0 max-w-full justify-self-start truncate text-xs">{{ secretShown ? jira.webhookSecret : '•'.repeat(24) }}</span>
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
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-copy"
              aria-label="Copy webhook secret"
              @click="copy('Webhook secret', jira.webhookSecret)"
            />
          </span>
        </div>
      </div>
    </div>

    <p
      v-if="jira?.configured && !jira.accountId"
      class="mt-4 text-2xs leading-normal text-error"
    >
      Reconnect once with the API token so mentions and "assigned to Knecht" triggers know the account.
    </p>
  </KPanel>
</template>
