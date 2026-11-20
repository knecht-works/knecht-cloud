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
import { NuxtLink, UBadge, UButton, UDropdownMenu, UIcon, USwitch, UTooltip } from '#components'

const props = defineProps<{ projectId?: number }>()

const toast = useToast()
const toastError = useToastError()
const { user } = useUserSession()
const { data: members } = await useMembers()
const isOwner = computed(() => !!members.value?.find(m => m.id === user.value?.id)?.isOwner)

const { data, refresh } = await useFetch<{ servers: McpServerView[], global: McpServerView[], offHere: number[] }>('/api/mcp-servers', {
  key: `mcp-servers:${props.projectId ?? 'global'}`,
  query: props.projectId ? { projectId: props.projectId } : {},
})
const servers = computed(() => data.value?.servers ?? [])
const ownNames = computed(() => new Set(servers.value.map(s => s.name)))
const offHere = computed(() => new Set(data.value?.offHere ?? []))
const rows = computed(() => [
  ...servers.value.map(server => ({ server, global: false })),
  ...(props.projectId ? data.value?.global ?? [] : []).map(server => ({ server, global: true })),
])

const editing = ref<McpServerView | null>(null)
const source = ref<string | null>(null)
const modalOpen = ref(false)
function openModal(server: McpServerView | null, catalogId: string | null = null) {
  editing.value = server
  source.value = catalogId
  modalOpen.value = true
}

type Status = { color: 'primary' | 'neutral' | 'error', text: string }
function status(server: McpServerView): Status {
  if (!server.enabled) return { color: 'neutral', text: 'Off' }
  if (server.auth === 'token') return { color: 'primary', text: 'Token' }
  if (server.auth === 'none') return { color: 'primary', text: server.headers.length ? 'Headers' : 'No authentication' }
  if (server.oauth.error) return { color: 'error', text: server.oauth.error }
  if (!server.oauth.connected) return { color: 'neutral', text: 'Not connected yet' }
  const at = new Date(server.oauth.connectedAt!).toLocaleDateString()
  return { color: 'primary', text: server.oauth.connectedBy ? `OAuth, connected by ${server.oauth.connectedBy} on ${at}` : `OAuth, connected on ${at}` }
}

function rowStatus(server: McpServerView, global: boolean): Status {
  if (global && ownNames.value.has(server.name)) return { color: 'neutral', text: 'Replaced by this project\'s server' }
  if (global && !server.enabled) return { color: 'neutral', text: 'Off in the global settings' }
  if (global && offHere.value.has(server.id)) return { color: 'neutral', text: 'Off in this project' }
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

async function setOnHere(server: McpServerView, on: boolean) {
  try {
    await $fetch(`/api/mcp-servers/${server.id}/project-off`, { method: 'PUT', body: { projectId: props.projectId, off: !on } })
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
    <div class="mb-2 flex items-center justify-between gap-6">
      <p class="max-w-2xl text-2sm leading-relaxed text-balance text-muted">
        <template v-if="projectId">
          Tools the agent gets in this project, on top of the servers from the global
          <NuxtLink
            to="/settings/agent"
            class="text-toned underline underline-offset-2"
          >Agent settings</NuxtLink>. Switch a global server off here, or replace it with a project server of the same name.
        </template>
        <template v-else>
          Tools the agent gets in every project. Knecht checks each server before every step and leaves out one it
          cannot reach, so a broken server never blocks a run.
        </template>
      </p>
      <UButton
        label="Add custom server"
        size="sm"
        class="shrink-0"
        :disabled="!isOwner"
        @click="openModal(null)"
      />
    </div>

    <ul
      v-if="rows.length"
      class="flex flex-col divide-y divide-muted rounded-md border border-muted"
    >
      <li
        v-for="{ server, global } in rows"
        :key="server.id"
        class="flex h-11 items-center gap-3 pe-2"
      >
        <component
          :is="global ? 'div' : 'button'"
          v-bind="global ? {} : { type: 'button', disabled: !isOwner }"
          class="flex h-full min-w-0 flex-1 items-center gap-3 ps-3.5 text-left enabled:cursor-pointer"
          :class="{ 'opacity-60': global && (ownNames.has(server.name) || !server.enabled || offHere.has(server.id)) }"
          @click="global ? undefined : openModal(server)"
        >
          <UIcon
            :name="mcpIcon(server.catalogId)"
            class="size-4.5 shrink-0"
            :class="mcpIconColor(server.catalogId)"
          />
          <span class="flex w-44 shrink-0 items-center gap-2">
            <span class="truncate text-sm text-highlighted">{{ server.name }}</span>
            <UBadge
              v-if="projectId"
              :label="global ? 'Global' : 'Project'"
              :color="global ? 'neutral' : 'primary'"
              variant="subtle"
              size="sm"
            />
          </span>
          <span class="flex min-w-0 items-center gap-1.5 text-xs">
            <KStatusDot
              :color="rowStatus(server, global).color"
              :glow="false"
            />
            <span
              class="truncate"
              :class="rowStatus(server, global).color === 'error' ? 'text-error' : 'text-muted'"
            >{{ rowStatus(server, global).text }}</span>
          </span>
        </component>
        <template v-if="global">
          <UTooltip
            v-if="server.enabled && !ownNames.has(server.name)"
            :text="offHere.has(server.id) ? 'Turn on in this project' : 'Turn off in this project'"
          >
            <USwitch
              :model-value="!offHere.has(server.id)"
              :aria-label="offHere.has(server.id) ? `Turn on ${server.name} in this project` : `Turn off ${server.name} in this project`"
              :disabled="!isOwner"
              @update:model-value="setOnHere(server, $event)"
            />
          </UTooltip>
          <UTooltip text="Open in the global settings">
            <UButton
              to="/settings/agent"
              icon="i-lucide-arrow-right"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Open ${server.name} in the global settings`"
            />
          </UTooltip>
        </template>
        <template v-else>
          <UButton
            v-if="needsConnect(server) && server.enabled"
            size="xs"
            :label="server.oauth.connected ? 'Reconnect' : 'Connect'"
            :disabled="!isOwner"
            @click="connect(server)"
          />
          <UTooltip :text="server.enabled ? 'Turn off' : 'Turn on'">
            <USwitch
              :model-value="server.enabled"
              :aria-label="server.enabled ? `Turn off ${server.name}` : `Turn on ${server.name}`"
              :disabled="!isOwner"
              @update:model-value="setEnabled(server, $event)"
            />
          </UTooltip>
          <UDropdownMenu
            :items="menu(server)"
            :content="{ align: 'end' }"
            :disabled="!isOwner"
          >
            <UTooltip text="Actions">
              <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="xs"
                :loading="testing === server.id"
                :disabled="!isOwner"
                :aria-label="`Actions for ${server.name}`"
              />
            </UTooltip>
          </UDropdownMenu>
        </template>
      </li>
    </ul>

    <div class="mb-2 mt-5 text-sm font-medium text-highlighted">
      {{ rows.length ? 'Or add a ready-made server' : 'Add a ready-made server' }}
    </div>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="entry in MCP_CATALOG"
        :key="entry.id"
        type="button"
        class="flex h-9 items-center gap-2 rounded-md border border-muted bg-elevated/50 px-3 text-sm text-highlighted transition-colors enabled:hover:border-accented enabled:hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="!isOwner"
        @click="openModal(null, entry.id)"
      >
        <UIcon
          :name="mcpIcon(entry.id)"
          class="size-4.5"
          :class="mcpIconColor(entry.id)"
        />
        {{ entry.label }}
        <span class="text-muted">{{ entry.summary }}</span>
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
