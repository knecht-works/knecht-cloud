<script setup lang="ts">
// Jira: the connection powering 'jira' triggers. The token is write-only: the
// form is for connecting/replacing, the connected state shows who the token
// authenticates as. Saving validates against Jira before anything is stored;
// field mistakes are caught inline before the request.
const toast = useToast()

interface JiraConnection {
  configured: boolean
  siteUrl: string | null
  email: string | null
  accountName: string | null
  /** Masked recognition preview of the stored token (first 8 + last 4 visible). */
  apiTokenPreview: string | null
}
const { data: jira } = useFetch<JiraConnection>('/api/jira/connection', { lazy: true })

const siteUrl = ref('')
const email = ref('')
const token = ref('')
watch(jira, (j) => {
  if (!j) return
  siteUrl.value = j.siteUrl ?? ''
  email.value = j.email ?? ''
}, { immediate: true })

// Mirrors the server's checks (https URL, email shape, token present) so the
// obvious mistakes show at the field; Jira itself is the real gatekeeper and
// its rejection lands in connectError.
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
      Jira triggers watch tickets (a label being added, a status being reached) and fire
      workflows with the ticket as <span class="k-mono text-xs text-toned">{{ '\{\{ inputs.* \}\}' }}</span>;
      finished runs comment the pull request link back on the ticket. Connect once with an
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
  </KPanel>
</template>
