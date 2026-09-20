<script setup lang="ts">
import { connectionIssues, normalizeConnection, type ConnectionFormDef } from '#shared/utils/connection-form'
import type { IntegrationId } from '#shared/utils/integrations'

const props = defineProps<{ id: IntegrationId, name: string, form: ConnectionFormDef }>()

const { connection, error, connecting, disconnecting, connect, disconnect, saveSecret } = useIntegrationConnection(props.id, props.name)

const secretKeys = computed(() => props.form.fields.filter(f => f.type === 'secret').map(f => f.key))
const values = reactive<Record<string, string>>({})
watch(connection, (c) => {
  if (!c) return
  for (const field of props.form.fields) {
    if (field.type !== 'secret') values[field.key] = c.values[field.key] ?? field.default ?? ''
  }
}, { immediate: true })

const fieldErrors = ref<Record<string, string>>({})
async function submit() {
  const next = normalizeConnection(props.form, values)
  fieldErrors.value = connectionIssues(props.form, next)
  if (Object.keys(fieldErrors.value).length) return
  if (await connect(next)) {
    for (const key of secretKeys.value) values[key] = ''
  }
}

function placeholder(field: ConnectionFormDef['fields'][number]): string | undefined {
  if (field.type !== 'secret') return field.placeholder
  return connection.value?.previews[field.key] ?? (connection.value?.configured ? 'Configured, enter a new one to replace it' : field.placeholder)
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
    </template>

    <p class="mb-5 max-w-3xl text-2sm leading-relaxed text-muted">
      {{ form.intro }}
      <a
        v-if="form.docs"
        :href="form.docs.url"
        target="_blank"
        class="text-toned underline underline-offset-2"
      >{{ form.docs.label }}</a>
    </p>

    <form
      class="grid grid-cols-1 items-start gap-5 xl:grid-cols-[repeat(var(--fields),1fr)_auto]"
      :style="{ '--fields': form.fields.length }"
      @submit.prevent="submit"
    >
      <div
        v-for="field in form.fields"
        :key="field.key"
      >
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">{{ field.label }}</span>
        <UInput
          v-model="values[field.key]"
          :type="field.type === 'secret' ? 'password' : 'text'"
          :placeholder="placeholder(field)"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          :color="fieldErrors[field.key] ? 'error' : undefined"
          :highlight="!!fieldErrors[field.key]"
          class="mt-2 w-full"
          :ui="field.mono ? { base: 'k-mono' } : undefined"
        />
        <p
          v-if="fieldErrors[field.key]"
          class="mt-2 text-xs leading-normal text-error"
        >
          {{ fieldErrors[field.key] }}
        </p>
      </div>
      <div class="flex gap-2 xl:mt-7.5">
        <UButton
          type="submit"
          color="primary"
          :label="connection?.configured ? 'Reconnect' : 'Connect'"
          :loading="connecting"
        />
        <UButton
          v-if="connection?.configured"
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
      v-if="connection?.configured"
      :name="name"
      :connection="connection"
      :setup-url="setupUrl"
      :reject-copy="form.webhook.rejectCopy"
      :event-copy="form.webhook.events"
      :save-secret="form.webhook.secret === 'pasted' ? saveSecret : undefined"
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
  </KPanel>
</template>
