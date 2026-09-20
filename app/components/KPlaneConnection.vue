<script setup lang="ts">
import type { WebhookConnection } from '~/composables/useIntegrationConnection'

interface PlaneConnection extends WebhookConnection {
  siteUrl: string | null
  workspaceSlug: string | null
  apiKeyPreview: string | null
}
const { connection: plane, error, connecting, disconnecting, connect, disconnect } = useIntegrationConnection<PlaneConnection>('/api/plane/connection', 'Plane')

const REJECT_COPY = {
  'signature': 'with a wrong secret. Replace the secret below with the secret key of the webhook.',
  'empty-body': 'without a body.',
  'no-project': 'for a Plane project no project is linked to yet, or for an event Knecht does not use.',
}
const EVENT_COPY = {
  'workitem.created': 'work item created',
  'workitem.updated': 'work item updated',
  'workitem.archived': 'work item archived',
  'workitem.deleted': 'work item deleted',
  'workitem.comment.created': 'comment on',
}

const siteUrl = ref('')
const workspaceSlug = ref('')
const apiKey = ref('')
watch(plane, (p) => {
  if (!p) return
  siteUrl.value = p.siteUrl ?? 'https://app.plane.so'
  workspaceSlug.value = p.workspaceSlug ?? ''
}, { immediate: true })

const fieldErrors = reactive({ siteUrl: '', workspaceSlug: '', apiKey: '' })
function validate(): boolean {
  fieldErrors.siteUrl = ''
  fieldErrors.workspaceSlug = ''
  fieldErrors.apiKey = ''
  const url = siteUrl.value.trim()
  if (!url) fieldErrors.siteUrl = 'Enter your Plane URL.'
  else if (!/^https:\/\/[^\s/]+/.test(url)) fieldErrors.siteUrl = 'Must be an https:// URL, e.g. https://app.plane.so.'
  const slug = workspaceSlug.value.trim()
  if (!slug) fieldErrors.workspaceSlug = 'Enter the workspace slug.'
  else if (!/^[a-z0-9-]+$/i.test(slug)) fieldErrors.workspaceSlug = 'The slug is the first path segment of your Plane URL, e.g. acme.'
  if (!apiKey.value.trim()) fieldErrors.apiKey = 'Paste an API key.'
  return !fieldErrors.siteUrl && !fieldErrors.workspaceSlug && !fieldErrors.apiKey
}

async function submit() {
  if (!validate()) return
  if (await connect({ siteUrl: siteUrl.value.trim(), workspaceSlug: workspaceSlug.value.trim(), apiKey: apiKey.value.trim() })) apiKey.value = ''
}

async function saveSecret(webhookSecret: string) {
  plane.value = await $fetch<PlaneConnection>('/api/plane/webhook-secret', { method: 'POST', body: { webhookSecret } })
}
</script>

<template>
  <KPanel
    title="Plane"
    icon="i-simple-icons-plane"
    :accent="integrationUi('plane').color"
  >
    <template #action>
      <span
        class="k-mono text-2xs"
        :class="plane?.configured ? 'text-primary' : 'text-dimmed'"
      >
        {{ plane ? (plane.configured ? `Connected as ${plane.accountName}` : 'Not connected') : 'Checking…' }}
      </span>
    </template>

    <p class="mb-5 max-w-3xl text-2sm leading-relaxed text-muted">
      Work items start workflows and get Knecht's replies. Connect with a personal access token
      (Profile settings → Personal access tokens), ideally of a dedicated "Knecht" account,
      then link each project to its Plane project in the project settings.
    </p>

    <form
      class="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1fr_1fr_auto]"
      @submit.prevent="submit"
    >
      <div>
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Plane URL</span>
        <UInput
          v-model="siteUrl"
          placeholder="https://app.plane.so"
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
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Workspace slug</span>
        <UInput
          v-model="workspaceSlug"
          placeholder="acme"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          :color="fieldErrors.workspaceSlug ? 'error' : undefined"
          :highlight="!!fieldErrors.workspaceSlug"
          class="mt-2 w-full"
          :ui="{ base: 'k-mono' }"
        />
        <p
          v-if="fieldErrors.workspaceSlug"
          class="mt-2 text-xs leading-normal text-error"
        >
          {{ fieldErrors.workspaceSlug }}
        </p>
      </div>
      <div>
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">API key</span>
        <UInput
          v-model="apiKey"
          type="password"
          :placeholder="plane?.apiKeyPreview ?? (plane?.configured ? 'Configured, enter a key to replace it' : 'plane_api_…')"
          :color="fieldErrors.apiKey ? 'error' : undefined"
          :highlight="!!fieldErrors.apiKey"
          class="mt-2 w-full"
        />
        <p
          v-if="fieldErrors.apiKey"
          class="mt-2 text-xs leading-normal text-error"
        >
          {{ fieldErrors.apiKey }}
        </p>
      </div>
      <div class="flex gap-2 xl:mt-7.5">
        <UButton
          type="submit"
          color="primary"
          :label="plane?.configured ? 'Reconnect' : 'Connect'"
          :loading="connecting"
        />
        <UButton
          v-if="plane?.configured"
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
      v-if="plane?.configured"
      name="Plane"
      :connection="plane"
      :setup-url="`${plane.siteUrl}/${plane.workspaceSlug}/settings/webhooks`"
      :reject-copy="REJECT_COPY"
      :event-copy="EVENT_COPY"
      :save-secret="saveSecret"
    >
      <template #instructions>
        Add a webhook in Plane with this URL, tick the <span class="text-toned">Work item</span> events
        created, updated, archived and deleted plus <span class="text-toned">Work item comment</span> created,
        then paste the secret key Plane generates below. Then edit any work item in a linked project.
      </template>
    </KWebhookStatus>
  </KPanel>
</template>
