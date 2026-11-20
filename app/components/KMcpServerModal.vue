<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { $fetch } from '#imports'
import { MCP_CATALOG, MCP_MAX_HEADERS, mcpCatalogEntry, type McpAuthMode, type McpServerView } from '#shared/utils/mcp'
import { useToastError } from '~/composables/useToastError'
import KSecretField from '~/components/KSecretField.vue'
import { UButton, UFormField, UInput, UModal, USelect, USwitch } from '#components'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  projectId: number | null
  server: McpServerView | null
}>()
const emit = defineEmits<{ saved: [McpServerView] }>()

const toastError = useToastError()

const CUSTOM = 'custom'
const AUTH_LABELS: Record<McpAuthMode, string> = { none: 'No sign-in', token: 'Token', oauth: 'Sign in with OAuth' }

interface HeaderRow { name: string, secret: boolean, value: string, preview: string | null }

const source = ref(CUSTOM)
const name = ref('')
const url = ref('')
const auth = ref<McpAuthMode>('none')
const token = ref('')
const headers = ref<HeaderRow[]>([])
const saving = ref(false)

const entry = computed(() => mcpCatalogEntry(source.value))
const authModes = (id: string): McpAuthMode[] => (mcpCatalogEntry(id)?.auth ?? ['none']).filter(mode => mode !== 'oauth')
const authItems = computed(() => authModes(source.value).map(id => ({ id, label: AUTH_LABELS[id] })))
const sourceItems = [
  ...MCP_CATALOG.map(e => ({ id: e.id, label: e.label, description: e.description })),
  { id: CUSTOM, label: 'Custom server', description: 'Any remote MCP server by URL' },
]

watch(open, (isOpen) => {
  if (!isOpen) return
  const s = props.server
  source.value = s?.catalogId ?? MCP_CATALOG[0]!.id
  name.value = s?.name ?? MCP_CATALOG[0]!.id
  url.value = s && !s.catalogId ? s.url : ''
  auth.value = s?.auth ?? authModes(source.value)[0]!
  token.value = ''
  headers.value = s?.headers.map(h => ({ name: h.name, secret: h.secret, value: h.value ?? '', preview: h.preview })) ?? []
}, { immediate: true })

function pickSource(next: string) {
  const previous = entry.value
  source.value = next
  if (!name.value || name.value === (previous?.id ?? '')) name.value = mcpCatalogEntry(next)?.id ?? ''
  auth.value = authModes(next)[0]!
}

function addHeader() {
  headers.value.push({ name: '', secret: true, value: '', preview: null })
}

async function save() {
  saving.value = true
  try {
    const body = {
      name: name.value.trim(),
      catalogId: entry.value?.id ?? null,
      url: entry.value ? null : url.value.trim(),
      auth: auth.value,
      ...(token.value.trim() ? { token: token.value.trim() } : {}),
      headers: entry.value
        ? []
        : headers.value.filter(h => h.name.trim()).map(h => ({
            name: h.name.trim(),
            secret: h.secret,
            ...(h.value || !h.secret ? { value: h.value } : {}),
          })),
      enabled: props.server?.enabled ?? true,
    }
    const saved = props.server
      ? await $fetch<McpServerView>(`/api/mcp-servers/${props.server.id}`, { method: 'PATCH', body })
      : await $fetch<McpServerView>('/api/mcp-servers', { method: 'POST', body: { ...body, projectId: props.projectId } })
    emit('saved', saved)
    open.value = false
  }
  catch (e) {
    toastError('Could not save the MCP server', e)
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="server ? `Edit ${server.name}` : 'Add MCP server'"
    :description="projectId ? 'Only this project\'s agent uses it.' : 'The agent uses it in every project.'"
  >
    <template #body>
      <form
        class="flex flex-col gap-4"
        @submit.prevent="save"
      >
        <UFormField
          label="Server"
          :hint="entry ? undefined : 'Remote servers only'"
        >
          <USelect
            :model-value="source"
            :items="sourceItems"
            value-key="id"
            :disabled="!!server"
            class="w-full"
            @update:model-value="pickSource($event as string)"
          />
          <p
            v-if="entry"
            class="mt-1.5 text-xs text-muted"
          >
            {{ entry.description }}
            <a
              :href="entry.docsUrl"
              target="_blank"
              rel="noopener"
              class="text-primary"
            >Docs</a>
          </p>
        </UFormField>

        <UFormField
          label="Name"
          hint="What the agent calls it. A project server of the same name replaces a global one."
        >
          <UInput
            v-model="name"
            placeholder="docs"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="!entry"
          label="URL"
        >
          <UInput
            v-model="url"
            placeholder="https://mcp.example.com/mcp"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="authItems.length > 1"
          label="Sign-in"
        >
          <USelect
            v-model="auth"
            :items="authItems"
            value-key="id"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="entry && auth === 'token'"
          :label="entry.token.label"
          :hint="entry.token.hint"
        >
          <KSecretField
            v-model="token"
            :preview="server?.catalogId === entry.id && server.auth === 'token' ? server.tokenPreview : null"
            :placeholder="entry.token.placeholder"
          />
        </UFormField>

        <div
          v-if="!entry"
          class="flex flex-col gap-2"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm text-highlighted">Headers</span>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              label="Add header"
              :disabled="headers.length >= MCP_MAX_HEADERS"
              @click="addHeader"
            />
          </div>
          <div
            v-for="(header, i) in headers"
            :key="i"
            class="flex items-center gap-2"
          >
            <UInput
              v-model="header.name"
              placeholder="Authorization"
              aria-label="Header name"
              class="w-36 shrink-0"
            />
            <KSecretField
              v-if="header.secret"
              v-model="header.value"
              :preview="header.preview"
              placeholder="Bearer …"
              aria-label="Header value"
              class="min-w-0 flex-1"
            />
            <UInput
              v-else
              v-model="header.value"
              aria-label="Header value"
              class="min-w-0 flex-1"
            />
            <USwitch
              v-model="header.secret"
              label="Secret"
              size="xs"
            />
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              aria-label="Remove header"
              @click="headers.splice(i, 1)"
            />
          </div>
        </div>

        <p class="text-xs text-dimmed">
          Secrets are stored encrypted. The agent can read them while it works, like the AI key.
        </p>

        <div class="flex justify-end">
          <UButton
            type="submit"
            size="lg"
            :label="server ? 'Save' : 'Add'"
            :loading="saving"
            :disabled="!name.trim() || (!entry && !url.trim())"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
