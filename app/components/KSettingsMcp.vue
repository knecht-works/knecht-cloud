<script setup lang="ts">
import { computed, ref } from 'vue'
import { navigateTo, useFetch, useToast, useUserSession, $fetch } from '#imports'
import { MCP_CATALOG, mcpCatalogEntry, type McpServerView } from '#shared/utils/mcp'
import { mcpIcon, mcpIconColor } from '~/utils/mcp'
import { useMembers } from '~/composables/useMembers'
import { useToastError } from '~/composables/useToastError'
import KPanel from '~/components/KPanel.vue'
import KConfirmModal from '~/components/KConfirmModal.vue'
import KMcpServerModal from '~/components/KMcpServerModal.vue'
import KStatusDot from '~/components/KStatusDot.vue'
import { UBadge, UButton, UDropdownMenu, UIcon, USwitch } from '#components'

const props = defineProps<{ projectId?: number }>()

const toast = useToast()
const toastError = useToastError()
const { user } = useUserSession()
const { data: members } = await useMembers()
const isOwner = computed(() => !!members.value?.find(m => m.id === user.value?.id)?.isOwner)

const { data, refresh } = await useFetch<{ servers: McpServerView[], global: McpServerView[] }>('/api/mcp-servers', {
  key: `mcp-servers:${props.projectId ?? 'global'}`,
  query: props.projectId ? { projectId: props.projectId } : {},
})
const servers = computed(() => data.value?.servers ?? [])
const ownNames = computed(() => new Set(servers.value.map(s => s.name)))
const rows = computed(() => [
  ...servers.value.map(server => ({ server, global: false })),
  ...(props.projectId ? data.value?.global ?? [] : []).map(server => ({ server, global: true })),
])
const tiles = [
  ...MCP_CATALOG.map(e => ({ id: e.id as string | null, label: e.label, description: e.description })),
  { id: null, label: 'Custom server', description: 'Any remote MCP server, by its URL.' },
]

const editing = ref<McpServerView | null>(null)
const source = ref<string | null>(null)
const modalOpen = ref(false)
function openModal(server: McpServerView | null, catalogId: string | null = null) {
  editing.value = server
  source.value = catalogId
  modalOpen.value = true
}

function describe(server: McpServerView): string {
  return mcpCatalogEntry(server.catalogId)?.label ?? server.url
}

type Status = { color: 'primary' | 'neutral' | 'error', text: string }
function status(server: McpServerView): Status {
  if (!server.enabled) return { color: 'neutral', text: 'Off' }
  if (server.auth !== 'oauth') return { color: 'primary', text: server.auth === 'token' ? 'Signed in with a token' : 'Ready' }
  if (server.oauth.error) return { color: 'error', text: server.oauth.error }
  if (!server.oauth.connected) return { color: 'neutral', text: 'Not connected yet' }
  const at = new Date(server.oauth.connectedAt!).toLocaleDateString()
  return { color: 'primary', text: server.oauth.connectedBy ? `Connected by ${server.oauth.connectedBy} on ${at}` : `Connected on ${at}` }
}

function rowStatus(server: McpServerView, global: boolean): Status {
  if (global && ownNames.value.has(server.name)) return { color: 'neutral', text: 'Replaced by this project\'s server' }
  if (global && !server.enabled) return { color: 'neutral', text: 'Off in the global settings' }
  return status(server)
}

const deleteDetail = computed(() => {
  const server = deleting.value
  if (!server) return ''
  const provider = mcpCatalogEntry(server.catalogId)?.label
  return [
    'Knecht also deletes its stored token, headers and OAuth sign-in. Runs that are already going lose it from their next step on.',
    server.auth === 'oauth' && server.oauth.connected
      ? `The access stays authorized at ${provider ?? 'the server'}, so revoke it there if nobody needs it anymore.`
      : '',
    props.projectId && data.value?.global.some(g => g.name === server.name)
      ? `The global server named ${server.name} applies to this project again.`
      : '',
    props.projectId ? '' : 'Every project loses it, unless it has its own server with this name.',
  ].filter(Boolean).join(' ')
})

function needsConnect(server: McpServerView): boolean {
  return server.auth === 'oauth' && (!server.oauth.connected || !!server.oauth.error)
}

function menu(server: McpServerView) {
  return [
    [
      { label: 'Test connection', icon: 'i-lucide-activity', onSelect: () => test(server) },
      ...(server.auth === 'oauth' && !needsConnect(server) ? [{ label: 'Reconnect', icon: 'i-lucide-refresh-cw', onSelect: () => connect(server) }] : []),
      { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openModal(server) },
    ],
    [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { deleting.value = server } }],
  ]
}

function connect(server: McpServerView) {
  return navigateTo(`/auth/mcp/${server.id}`, { external: true })
}

async function setEnabled(server: McpServerView, enabled: boolean) {
  try {
    await $fetch(`/api/mcp-servers/${server.id}`, {
      method: 'PATCH',
      body: {
        name: server.name,
        catalogId: server.catalogId,
        url: server.catalogId ? null : server.url,
        auth: server.auth,
        headers: server.headers.map(h => ({ name: h.name, secret: h.secret, ...(h.secret ? {} : { value: h.value }) })),
        enabled,
      },
    })
    await refresh()
  }
  catch (e) {
    toastError('Could not change the MCP server', e)
  }
}

const testing = ref<number | null>(null)
async function test(server: McpServerView) {
  testing.value = server.id
  try {
    const { tools } = await $fetch<{ tools: string[] }>(`/api/mcp-servers/${server.id}/test`, { method: 'POST' })
    toast.add({
      title: `${server.name} answers with ${tools.length} tool${tools.length === 1 ? '' : 's'}`,
      description: tools.join(', ') || undefined,
      color: 'success',
    })
  }
  catch (e) {
    toastError('Connection failed', e)
  }
  finally {
    testing.value = null
  }
}

const deleting = ref<McpServerView | null>(null)
const confirmDelete = computed({
  get: () => !!deleting.value,
  set: (open) => { if (!open) deleting.value = null },
})
async function remove() {
  try {
    await $fetch(`/api/mcp-servers/${deleting.value!.id}`, { method: 'DELETE' })
    deleting.value = null
    await refresh()
  }
  catch (e) {
    toastError('Could not delete the MCP server', e)
  }
}
</script>

<template>
  <KPanel
    title="MCP servers"
    icon="i-lucide-plug"
    accent="var(--accent-orange)"
  >
    <p class="mb-2.5 max-w-3xl text-2sm leading-relaxed text-muted">
      <template v-if="projectId">
        Tools the agent gets in this project, on top of the global servers from Settings → Agent.
      </template>
      <template v-else>
        Tools the agent gets in every project. A project can add its own or replace one by its name.
      </template>
    </p>

    <ul
      v-if="rows.length"
      class="mb-5 flex flex-col divide-y divide-muted rounded-md border border-muted"
    >
      <li
        v-for="{ server, global } in rows"
        :key="server.id"
        class="flex items-center gap-3 px-3.5 py-3"
        :class="{ 'opacity-60': global && (ownNames.has(server.name) || !server.enabled) }"
      >
        <div class="flex size-8 flex-none items-center justify-center rounded-md border border-default bg-elevated">
          <UIcon
            :name="mcpIcon(server.catalogId)"
            class="size-4.5"
            :class="mcpIconColor(server.catalogId)"
          />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-sm text-highlighted">{{ server.name }}</span>
            <UBadge
              v-if="global"
              label="Global"
              color="neutral"
              variant="subtle"
              size="sm"
            />
            <span class="k-mono truncate text-2xs text-dimmed">{{ describe(server) }}</span>
          </div>
          <div class="mt-0.5 flex items-center gap-1.5 text-xs">
            <KStatusDot
              :color="rowStatus(server, global).color"
              :glow="false"
            />
            <span
              class="truncate"
              :class="rowStatus(server, global).color === 'error' ? 'text-error' : 'text-muted'"
            >{{ rowStatus(server, global).text }}</span>
          </div>
        </div>
        <template v-if="!global">
          <UButton
            v-if="needsConnect(server) && server.enabled"
            size="xs"
            :label="server.oauth.connected ? 'Reconnect' : 'Connect'"
            :disabled="!isOwner"
            @click="connect(server)"
          />
          <USwitch
            :model-value="server.enabled"
            :aria-label="server.enabled ? `Turn off ${server.name}` : `Turn on ${server.name}`"
            :disabled="!isOwner"
            @update:model-value="setEnabled(server, $event)"
          />
          <UDropdownMenu
            :items="menu(server)"
            :content="{ align: 'end' }"
            :disabled="!isOwner"
          >
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              size="xs"
              :loading="testing === server.id"
              :disabled="!isOwner"
              :aria-label="`Actions for ${server.name}`"
            />
          </UDropdownMenu>
        </template>
      </li>
    </ul>

    <div
      v-if="rows.length"
      class="mb-2 text-sm font-medium text-highlighted"
    >
      Add a server
    </div>
    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
      <button
        v-for="item in tiles"
        :key="item.id ?? 'custom'"
        type="button"
        class="group flex flex-col gap-2 rounded-md border border-muted bg-elevated/50 p-3.5 text-left transition-colors enabled:hover:border-accented enabled:hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="!isOwner"
        @click="openModal(null, item.id)"
      >
        <div class="flex items-center gap-2.5">
          <UIcon
            :name="mcpIcon(item.id)"
            class="size-5"
            :class="mcpIconColor(item.id)"
          />
          <span class="text-sm text-highlighted">{{ item.label }}</span>
          <UIcon
            name="i-lucide-plus"
            class="ml-auto size-3.5 text-dimmed transition-colors group-enabled:group-hover:text-highlighted"
          />
        </div>
        <span class="line-clamp-2 text-xs leading-relaxed text-muted">{{ item.description }}</span>
      </button>
    </div>

    <KMcpServerModal
      v-model:open="modalOpen"
      :project-id="projectId ?? null"
      :server="editing"
      :source="source"
      @saved="refresh()"
    />
    <KConfirmModal
      v-model:open="confirmDelete"
      title="Delete the MCP server?"
      :description="deleting ? `The agent loses the tools of ${deleting.name}.` : ''"
      :detail="deleteDetail"
      @confirm="remove"
    />
  </KPanel>
</template>
