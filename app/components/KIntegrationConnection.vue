<script setup lang="ts">
import { connectionIssues, normalizeConnection, type ConnectionFormDef } from '#shared/utils/connection-form'
import type { IntegrationId } from '#shared/utils/integrations'

const props = defineProps<{ id: IntegrationId, name: string, form: ConnectionFormDef, editable: boolean }>()

const { connection, error, connecting, disconnecting, connect, disconnect, saveSecret } = await useIntegrationConnection(props.id, props.name)

const secretKeys = computed(() => props.form.fields.filter(f => f.type === 'secret').map(f => f.key))
const values = reactive<Record<string, string>>({})
function load() {
  const c = connection.value
  if (!c) return
  for (const field of props.form.fields) {
    values[field.key] = field.type === 'secret' ? '' : c.values[field.key] ?? field.default ?? ''
  }
}

const dirty = computed(() => props.form.fields.some((field) => {
  const value = values[field.key]?.trim() ?? ''
  if (field.type === 'secret') return !!value
  return value !== (connection.value?.values[field.key] ?? field.default ?? '')
}))

// Live refreshes (e.g. a webhook delivery) must not wipe an edit.
watch(connection, (_, previous) => {
  if (!previous || !dirty.value) load()
}, { immediate: true })

const fieldErrors = ref<Record<string, string>>({})
async function submit() {
  const next = normalizeConnection(props.form, values)
  // An empty secret on a connected integration keeps the stored one.
  const keepsStored = (key: string) => !!connection.value?.configured && secretKeys.value.includes(key) && !next[key]
  const issues = Object.fromEntries(Object.entries(connectionIssues(props.form, next)).filter(([key]) => !keepsStored(key)))
  fieldErrors.value = issues
  if (Object.keys(issues).length) return
  if (await connect(next)) load()
}

const showActions = computed(() => props.editable && !!connection.value && (!connection.value.configured || dirty.value))

const confirmingDisconnect = ref(false)
async function confirmDisconnect() {
  if (!await disconnect()) return
  confirmingDisconnect.value = false
  load()
}

const setupUrl = computed(() => props.form.webhook.setupUrl.replace(/\{(\w+)\}/g, (_, key: string) => connection.value?.values[key] ?? ''))
</script>

<template>
  <KPanel
    :title="name"
    :icon="integrationUi(id).icon"
    :accent="integrationUi(id).color"
  >
    <template #action>
      <span
        class="k-mono text-2xs"
        :class="connection?.configured ? 'text-primary' : 'text-dimmed'"
      >
        {{ connection ? (connection.configured ? `Connected as ${connection.accountName}` : 'Not connected') : 'Checking…' }}
      </span>
      <UDropdownMenu
        v-if="editable && connection?.configured"
        :items="[{ label: 'Disconnect', icon: 'i-lucide-unplug', color: 'error', onSelect: () => { confirmingDisconnect = true } }]"
        :content="{ align: 'end' }"
      >
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="ghost"
          size="xs"
          class="-mr-2 ml-2"
          :aria-label="`Actions for ${name}`"
        />
      </UDropdownMenu>
    </template>

    <p class="mb-4 max-w-3xl text-2sm leading-relaxed text-muted">
      {{ form.intro }}
      <a
        v-if="form.docs"
        :href="form.docs.url"
        target="_blank"
        class="text-toned underline underline-offset-2"
      >{{ form.docs.label }}</a>
    </p>

    <form
      class="grid grid-cols-1 items-start gap-x-5 gap-y-4 md:grid-cols-2 xl:[grid-template-columns:var(--cols)]"
      :style="{ '--cols': `repeat(${form.fields.length}, minmax(0, 1fr))${showActions ? ' auto' : ''}` }"
      @submit.prevent="submit"
    >
      <UFormField
        v-for="field in form.fields"
        :key="field.key"
        :label="field.label"
        :error="fieldErrors[field.key]"
      >
        <KSecretField
          v-if="field.type === 'secret'"
          v-model="values[field.key]!"
          :preview="connection?.previews[field.key]"
          :placeholder="field.placeholder"
          :disabled="!editable"
          :invalid="!!fieldErrors[field.key]"
        />
        <UInput
          v-else
          v-model="values[field.key]"
          :placeholder="field.placeholder"
          :disabled="!editable"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          :color="fieldErrors[field.key] ? 'error' : undefined"
          :highlight="!!fieldErrors[field.key]"
          class="w-full"
        />
      </UFormField>
      <div
        v-if="showActions"
        class="flex gap-2 xl:mt-7"
      >
        <UButton
          type="submit"
          color="primary"
          :label="connection?.configured ? 'Save' : 'Connect'"
          :loading="connecting"
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
      v-if="connection?.configured"
      :name="name"
      :connection="connection"
      :setup-url="setupUrl"
      :reject-copy="form.webhook.rejectCopy"
      :event-copy="form.webhook.events"
      :pasted="form.webhook.secret === 'pasted'"
      :editable="editable"
      :save-secret="saveSecret"
    >
      <template #instructions>
        {{ form.webhook.instructions }}
      </template>
    </KWebhookStatus>

    <p
      v-if="connection?.configured && !connection.accountId"
      class="mt-4 text-2xs leading-normal text-error"
    >
      Reconnect once so mentions and "assigned to Knecht" triggers know the account.
    </p>

    <KConfirmModal
      v-model:open="confirmingDisconnect"
      :title="`Disconnect ${name}?`"
      :description="`Triggers from ${name} stop working.`"
      :detail="`Knecht deletes the stored credentials and the webhook secret. To use ${name} again, connect it and set up the webhook anew.`"
      confirm-label="Disconnect"
      :loading="disconnecting"
      @confirm="confirmDisconnect"
    />
  </KPanel>
</template>
