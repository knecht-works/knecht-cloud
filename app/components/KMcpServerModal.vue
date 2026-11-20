<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { $fetch, navigateTo, useRequestURL, useToast } from '#imports'
import { MCP_MAX_HEADERS, mcpCatalogEntry, type McpAuthMode, type McpServerView } from '#shared/utils/mcp'
import { errMsg } from '~/utils/dashboard'
import { mcpIcon, mcpIconColor } from '~/utils/mcp'
import { copyText } from '~/utils/clipboard'
import KSecretField from '~/components/KSecretField.vue'
import { UAlert, UButton, UFormField, UIcon, UInput, UModal, USelect, USwitch, UTooltip } from '#components'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  projectId: number | null
  server: McpServerView | null
  // A catalog id, or null for a custom server.
  source: string | null
}>()
const emit = defineEmits<{ saved: [McpServerView] }>()

const toast = useToast()
const callbackUrl = `${useRequestURL().origin}/auth/mcp/callback`

// A custom server's API key goes in a header, so it gets a Headers tab instead of Token.
type SignIn = McpAuthMode | 'headers'
const SIGN_IN_LABELS: Record<SignIn, string> = { none: 'None', token: 'Token', headers: 'Headers', oauth: 'OAuth' }

interface HeaderRow { name: string, secret: boolean, value: string, preview: string | null }

const name = ref('')
const url = ref('')
const auth = ref<SignIn>('none')
const token = ref('')
const headers = ref<HeaderRow[]>([])
const ownClient = ref(false)
const clientId = ref('')
const clientSecret = ref('')
const saving = ref(false)
const error = ref<{ field: 'name' | 'url' | null, message: string } | null>(null)

const catalogId = computed(() => props.server ? props.server.catalogId : props.source)
const entry = computed(() => mcpCatalogEntry(catalogId.value))
const authModes = computed<readonly SignIn[]>(() => entry.value?.auth ?? ['none', 'headers', 'oauth'])
const authItems = computed(() => authModes.value.map(value => ({ value, label: SIGN_IN_LABELS[value] })))
const title = computed(() => entry.value?.label ?? (props.server?.name || 'Custom server'))

watch(open, (isOpen) => {
  if (!isOpen) return
  const s = props.server
  name.value = s?.name ?? entry.value?.id ?? ''
  url.value = s && !s.catalogId ? s.url : ''
  auth.value = s?.auth === 'none' && s.headers.length ? 'headers' : s?.auth ?? authModes.value[0]!
  token.value = ''
  headers.value = s?.headers.map(h => ({ name: h.name, secret: h.secret, value: h.value ?? '', preview: h.preview })) ?? []
  ownClient.value = !!s?.oauth.manualClient
  clientId.value = ''
  clientSecret.value = ''
  error.value = null
}, { immediate: true })

watch([name, url, auth], () => {
  error.value = null
})

// Sized for the tallest authentication method, so switching it does not resize the dialog.
const form = useTemplateRef<HTMLFormElement>('form')
const minHeight = ref(0)
watch(form, async (el) => {
  if (!el) return
  minHeight.value = 0
  const chosen = auth.value
  let tallest = 0
  for (const mode of authModes.value) {
    auth.value = mode
    await nextTick()
    tallest = Math.max(tallest, el.offsetHeight)
  }
  auth.value = chosen
  minHeight.value = tallest
})

const connects = computed(() => auth.value === 'oauth' && !props.server?.oauth.connected)
const submitLabel = computed(() => connects.value ? `Connect${entry.value ? ` with ${entry.value.label}` : ''}` : props.server ? 'Save' : 'Add')
const canSubmit = computed(() => !!name.value.trim()
  && (!!entry.value || !!url.value.trim())
  && !(ownClient.value && auth.value === 'oauth' && !entry.value && !clientId.value.trim() && !props.server?.oauth.manualClient))

function oauthClient() {
  if (entry.value || auth.value !== 'oauth') return {}
  if (ownClient.value && clientId.value.trim()) return { oauthClient: { id: clientId.value.trim(), secret: clientSecret.value.trim() || undefined } }
  if (!ownClient.value && props.server?.oauth.manualClient) return { oauthClient: null }
  return {}
}

async function copyCallback() {
  try {
    await copyText(callbackUrl)
    toast.add({ title: 'Redirect URL copied', color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not copy the redirect URL', color: 'error' })
  }
}

watch(auth, (mode) => {
  if (mode === 'headers' && !headers.value.length) addHeader()
})

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
      auth: auth.value === 'headers' ? 'none' : auth.value,
      ...(token.value.trim() ? { token: token.value.trim() } : {}),
      headers: auth.value !== 'headers'
        ? []
        : headers.value.filter(h => h.name.trim()).map(h => ({
            name: h.name.trim(),
            secret: h.secret,
            ...(h.value || !h.secret ? { value: h.value } : {}),
          })),
      ...oauthClient(),
      enabled: props.server?.enabled ?? true,
    }
    const saved = props.server
      ? await $fetch<McpServerView>(`/api/mcp-servers/${props.server.id}`, { method: 'PATCH', body })
      : await $fetch<McpServerView>('/api/mcp-servers', { method: 'POST', body: { ...body, projectId: props.projectId } })
    emit('saved', saved)
    open.value = false
    if (saved.auth === 'oauth' && !saved.oauth.connected) await navigateTo(`/auth/mcp/${saved.id}`, { external: true })
  }
  catch (e) {
    const message = errMsg(e, 'Could not save the MCP server.')
    const field = /^(name|url): (.+)$/.exec(message)
    error.value = field
      ? { field: field[1] as 'name' | 'url', message: field[2]!.charAt(0).toUpperCase() + field[2]!.slice(1) }
      : { field: null, message }
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'sm:max-w-xl', body: 'border-b-0', footer: 'justify-end' }"
  >
    <template #title>
      <span class="flex items-center gap-2.5">
        <span class="flex size-8 flex-none items-center justify-center rounded-md border border-default bg-elevated">
          <UIcon
            :name="mcpIcon(catalogId)"
            class="size-5"
            :class="mcpIconColor(catalogId)"
          />
        </span>
        {{ server ? `Edit ${title}` : title }}
      </span>
    </template>
    <template #description>
      <template v-if="entry">
        {{ entry.description }}
        <a
          :href="entry.docsUrl"
          target="_blank"
          rel="noopener"
          class="text-toned underline underline-offset-2"
        >Docs</a>
      </template>
      <template v-else>
        Any remote MCP server, reached by its URL.
      </template>
    </template>

    <template #body>
      <form
        id="mcp-server-form"
        ref="form"
        :style="minHeight ? { minHeight: `${minHeight}px` } : undefined"
        class="flex flex-col gap-4"
        @submit.prevent="save"
      >
        <UFormField
          v-if="!entry"
          label="URL"
          :error="error?.field === 'url' ? error.message : undefined"
        >
          <UInput
            v-model="url"
            placeholder="https://mcp.example.com/mcp"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Name"
          :error="error?.field === 'name' ? error.message : undefined"
          :help="projectId ? 'The agent sees its tools under this name. It replaces a global server with the same name here.' : 'The agent sees its tools under this name.'"
        >
          <UInput
            v-model="name"
            placeholder="docs"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="authItems.length > 1"
          label="Authentication"
        >
          <USelect
            v-model="auth"
            :items="authItems"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="entry && auth === 'token'"
          :label="entry.token.label"
          :help="entry.token.hint"
        >
          <KSecretField
            v-model="token"
            :preview="server?.catalogId === entry.id && server.auth === 'token' ? server.tokenPreview : null"
            :placeholder="entry.token.placeholder"
          />
        </UFormField>
        <div
          v-if="!entry && auth === 'oauth'"
          class="flex flex-col gap-4 rounded-md border border-default p-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-highlighted">
                Own OAuth client
              </p>
              <p class="text-sm text-muted">
                Only needed when the server does not let Knecht register itself.
              </p>
            </div>
            <USwitch
              v-model="ownClient"
              aria-label="Use my own OAuth client"
            />
          </div>
          <template v-if="ownClient">
            <UFormField
              label="Redirect URL"
              help="Enter it as the redirect URL of your client."
            >
              <UInput
                :model-value="callbackUrl"
                disabled
                class="w-full"
              >
                <template #trailing>
                  <UTooltip text="Copy redirect URL">
                    <UButton
                      color="neutral"
                      variant="link"
                      size="sm"
                      icon="i-lucide-copy"
                      aria-label="Copy redirect URL"
                      @click="copyCallback"
                    />
                  </UTooltip>
                </template>
              </UInput>
            </UFormField>
            <UFormField label="Client ID">
              <UInput
                v-model="clientId"
                :placeholder="server?.oauth.manualClient ? 'Leave empty to keep the stored client' : ''"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Client secret"
              help="Leave it empty for a public client without a secret."
            >
              <KSecretField
                v-model="clientSecret"
                :preview="null"
              />
            </UFormField>
          </template>
        </div>

        <UFormField
          v-if="auth === 'headers'"
          label="Headers"
          description="Sent with every request, for example an API key."
        >
          <div class="flex flex-col gap-2">
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
              <UTooltip :text="header.secret ? 'Stored as a secret. Click to store it in plain text.' : 'Stored in plain text. Click to store it as a secret.'">
                <UButton
                  color="neutral"
                  variant="outline"
                  :icon="header.secret ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                  :aria-label="header.secret ? 'Secret, click to store it in plain text' : 'Plain text, click to store it as a secret'"
                  :aria-pressed="header.secret"
                  @click="header.secret = !header.secret"
                />
              </UTooltip>
              <UTooltip text="Remove header">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  aria-label="Remove header"
                  @click="headers.splice(i, 1)"
                />
              </UTooltip>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              label="Add header"
              class="self-start"
              :disabled="headers.length >= MCP_MAX_HEADERS"
              @click="addHeader"
            />
          </div>
        </UFormField>
        <UAlert
          v-if="error && !error.field"
          color="error"
          variant="subtle"
          :description="error.message"
        />
      </form>
    </template>

    <template #footer>
      <UButton
        type="submit"
        form="mcp-server-form"
        size="lg"
        :label="submitLabel"
        :loading="saving"
        :disabled="!canSubmit"
      />
    </template>
  </UModal>
</template>
