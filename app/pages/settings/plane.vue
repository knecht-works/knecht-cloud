<script setup lang="ts">
const toast = useToast()

interface PlaneConnection {
  configured: boolean
  siteUrl: string | null
  workspaceSlug: string | null
  accountName: string | null
  accountId: string | null
  apiKeyPreview: string | null
  webhookUrl: string | null
  webhookSecretConfigured: boolean
  webhookEvents: string[]
  lastDelivery: { at: number, summary: string } | null
  lastRejected: { at: number, reason: 'signature' | 'empty-body' | 'no-project' } | null
}
const { data: plane, refresh: refreshPlane } = useFetch<PlaneConnection>('/api/plane/connection', { lazy: true })

let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  poll = setInterval(() => {
    if (plane.value?.configured) void refreshPlane()
  }, 5000)
})
onUnmounted(() => clearInterval(poll))

const REJECT_COPY: Record<NonNullable<PlaneConnection['lastRejected']>['reason'], string> = {
  'signature': 'with a wrong secret. Paste the secret key of the webhook into the form again.',
  'empty-body': 'without a body.',
  'no-project': 'for a Plane project no project is linked to yet, or for an event Knecht does not use.',
}
const EVENT_COPY: Record<string, string> = {
  'workitem.created': 'work item created',
  'workitem.updated': 'work item updated',
  'workitem.archived': 'work item archived',
  'workitem.deleted': 'work item deleted',
  'workitem.comment.created': 'comment on',
}
function humanSummary(summary: string): string {
  const [event, key] = summary.split(' ')
  return `${EVENT_COPY[event ?? ''] ?? event} ${key ?? ''}`.trim()
}
const deliveryState = computed(() => {
  const p = plane.value
  if (!p?.configured) return null
  if (!p.webhookSecretConfigured) return { tone: 'waiting' as const, text: 'Create the webhook in Plane and paste its secret key above' }
  const rejected = p.lastRejected
  const delivered = p.lastDelivery
  if (rejected && (!delivered || rejected.at > delivered.at)) {
    return { tone: 'error' as const, text: `Plane sent a delivery ${timeAgo(rejected.at)} ${REJECT_COPY[rejected.reason]}` }
  }
  if (delivered) return { tone: 'ok' as const, text: `Receiving events · ${humanSummary(delivered.summary)}, ${timeAgo(delivered.at)}` }
  return { tone: 'waiting' as const, text: 'Waiting for Plane' }
})
const detailsOpen = ref(false)
const showDetails = computed(() => deliveryState.value?.tone !== 'ok' || detailsOpen.value)

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
const workspaceSlug = ref('')
const apiKey = ref('')
const webhookSecret = ref('')
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
  if (!apiKey.value.trim() && !plane.value?.configured) fieldErrors.apiKey = 'Paste an API key.'
  return !fieldErrors.siteUrl && !fieldErrors.workspaceSlug && !fieldErrors.apiKey
}

const connectError = ref('')
const connecting = ref(false)
async function connect() {
  connectError.value = ''
  if (!validate()) return
  connecting.value = true
  try {
    plane.value = await $fetch<PlaneConnection>('/api/plane/connection', {
      method: 'POST',
      body: {
        siteUrl: siteUrl.value.trim(),
        workspaceSlug: workspaceSlug.value.trim(),
        apiKey: apiKey.value.trim(),
        webhookSecret: webhookSecret.value.trim(),
      },
    })
    apiKey.value = ''
    webhookSecret.value = ''
    toast.add({ title: `Connected as ${plane.value.accountName}`, color: 'success' })
  }
  catch (e) {
    connectError.value = errMsg(e, 'Could not connect to Plane.')
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
    plane.value = await $fetch<PlaneConnection>('/api/plane/connection', { method: 'DELETE' })
    toast.add({ title: 'Plane disconnected', color: 'success' })
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
      class="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]"
      @submit.prevent="connect"
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
      <div>
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Webhook secret</span>
        <UInput
          v-model="webhookSecret"
          type="password"
          :placeholder="plane?.webhookSecretConfigured ? 'Configured, paste a key to replace it' : 'plane_wh_…'"
          class="mt-2 w-full"
        />
      </div>
      <div class="flex gap-2 xl:mt-7.5">
        <UButton
          type="submit"
          color="primary"
          :label="plane?.configured ? 'Save' : 'Connect'"
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
      v-if="connectError"
      class="mt-4 text-xs leading-normal text-error"
    >
      {{ connectError }}
    </p>

    <div
      v-if="plane?.configured && deliveryState"
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
          :to="`${plane.siteUrl}/${plane.workspaceSlug}/settings/webhooks`"
          target="_blank"
          color="primary"
          size="sm"
          icon="i-lucide-external-link"
          label="Set up in Plane"
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
          Add a webhook in Plane with this URL, tick the <span class="text-toned">Work item</span> events
          created, updated, archived and deleted plus <span class="text-toned">Work item comment</span> created,
          then paste the secret key Plane generates into the form above. Then edit any work item in a linked project.
        </p>
        <div class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
          <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">URL</span>
          <code class="k-mono min-w-0 truncate text-xs text-toned">{{ plane.webhookUrl }}</code>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-copy"
            aria-label="Copy webhook URL"
            @click="copy('Webhook URL', plane.webhookUrl)"
          />
        </div>
      </div>
    </div>
  </KPanel>
</template>
