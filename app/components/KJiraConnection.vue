<script setup lang="ts">
import type { WebhookConnection } from '~/composables/useIntegrationConnection'

interface JiraConnection extends WebhookConnection {
  siteUrl: string | null
  email: string | null
  accountId: string | null
  apiTokenPreview: string | null
}
const { connection: jira, error, connecting, disconnecting, connect, disconnect } = useIntegrationConnection<JiraConnection>('/api/jira/connection', 'Jira')

const REJECT_COPY = {
  'signature': 'with a wrong secret. Paste the secret into the webhook again.',
  'empty-body': 'without a body. Uncheck "Exclude body" in the webhook.',
  'no-project': 'for a Jira project no project is linked to yet.',
}
const EVENT_COPY = {
  'jira:issue_created': 'issue created',
  'jira:issue_updated': 'issue updated',
  'jira:issue_deleted': 'issue deleted',
  'comment_created': 'comment on',
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

async function submit() {
  if (!validate()) return
  if (await connect({ siteUrl: siteUrl.value.trim(), email: email.value.trim(), apiToken: token.value.trim() })) token.value = ''
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
      @submit.prevent="submit"
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
      v-if="error"
      class="mt-4 text-xs leading-normal text-error"
    >
      {{ error }}
    </p>

    <KWebhookStatus
      v-if="jira?.configured"
      name="Jira"
      :connection="jira"
      :setup-url="`${jira.siteUrl}/plugins/servlet/webhooks`"
      :reject-copy="REJECT_COPY"
      :event-copy="EVENT_COPY"
    >
      <template #instructions>
        Create a webhook in Jira with these two values, tick <span class="text-toned">Issue created, updated, deleted</span>
        and <span class="text-toned">Comment created</span>, and leave "Exclude body" unchecked.
        Then edit any ticket in a linked project.
      </template>
    </KWebhookStatus>

    <p
      v-if="jira?.configured && !jira.accountId"
      class="mt-4 text-2xs leading-normal text-error"
    >
      Reconnect once with the API token so mentions and "assigned to Knecht" triggers know the account.
    </p>
  </KPanel>
</template>
