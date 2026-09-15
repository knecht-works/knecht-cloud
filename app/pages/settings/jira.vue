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
}
const { data: jira } = useFetch<JiraConnection>('/api/jira/connection', { lazy: true })

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
    accent="var(--color-jira)"
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
      Jira tickets start workflows through a webhook (created, labeled, moved to a status, or
      assigned to Knecht) with the ticket as <span class="k-mono text-xs text-toned">{{ '\{\{ inputs.* \}\}' }}</span>;
      the agent replies, labels and transitions the ticket, mentions of the account create
      follow-ups, and finished runs report their pull request on the ticket. Connect once with an
      <a
        href="https://id.atlassian.com/manage-profile/security/api-tokens"
        target="_blank"
        class="text-toned underline underline-offset-2"
      >API token</a>; a dedicated service account (e.g. "Knecht") keeps comments under its
      own name and scopes what Knecht can see.
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
      v-if="jira?.configured"
      class="mt-7 border-t border-muted pt-6"
    >
      <span class="k-label">Webhook</span>
      <p class="mt-2 max-w-3xl text-2xs leading-relaxed text-muted">
        Register this webhook once in Jira (Settings → System → WebHooks, as a Jira admin) with the
        secret below and the listed events; Knecht verifies every delivery with it.
        Knecht only reacts to tickets of Jira projects that a project links to in its settings.
      </p>

      <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div>
          <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">URL</span>
          <div class="mt-2 flex items-center gap-2">
            <code class="k-mono min-w-0 flex-1 truncate rounded-md border border-muted bg-(--surface-muted) px-3 py-2 text-xs text-toned">{{ jira.webhookUrl }}</code>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-copy"
              aria-label="Copy webhook URL"
              @click="copy('Webhook URL', jira.webhookUrl)"
            />
          </div>
        </div>
        <div>
          <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Secret</span>
          <div class="mt-2 flex items-center gap-2">
            <code class="k-mono min-w-0 flex-1 truncate rounded-md border border-muted bg-(--surface-muted) px-3 py-2 text-xs text-toned">{{ secretShown ? jira.webhookSecret : '•'.repeat(24) }}</code>
            <UButton
              color="neutral"
              variant="outline"
              :icon="secretShown ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :aria-label="secretShown ? 'Hide secret' : 'Reveal secret'"
              @click="() => { secretShown = !secretShown }"
            />
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-copy"
              aria-label="Copy webhook secret"
              @click="copy('Webhook secret', jira.webhookSecret)"
            />
          </div>
        </div>
      </div>

      <div class="mt-4">
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Events</span>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <span
            v-for="event in jira.webhookEvents"
            :key="event"
            class="k-mono rounded-full border border-default px-2.5 py-1 text-2xs text-muted"
          >{{ event }}</span>
        </div>
      </div>

      <p
        v-if="!jira.accountId"
        class="mt-4 text-2xs leading-normal text-error"
      >
        Reconnect once with the API token: mentions and "assigned to Knecht" triggers need the account id, which this connection was made before Knecht stored it.
      </p>
      <p
        v-else
        class="mt-4 text-2xs text-dimmed"
      >
        Connected as {{ jira.accountName }}<span
          v-if="jira.accountId"
          class="k-mono"
        > ({{ jira.accountId }})</span>. Mention this account in a ticket comment to give Knecht a follow-up.
      </p>
    </div>
  </KPanel>
</template>
