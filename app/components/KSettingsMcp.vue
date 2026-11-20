<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFetch, useToast, useUserSession, $fetch } from '#imports'
import { mcpCatalogEntry, type McpServerView } from '#shared/utils/mcp'
import { useMembers } from '~/composables/useMembers'
import { useToastError } from '~/composables/useToastError'
import KPanel from '~/components/KPanel.vue'
import KConfirmModal from '~/components/KConfirmModal.vue'
import KMcpServerModal from '~/components/KMcpServerModal.vue'
import { UButton, USwitch, UTooltip } from '#components'

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

const editing = ref<McpServerView | null>(null)
const modalOpen = ref(false)
function openModal(server: McpServerView | null) {
  editing.value = server
  modalOpen.value = true
}

function describe(server: McpServerView): string {
  return mcpCatalogEntry(server.catalogId)?.label ?? server.url
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
    <template #action>
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        label="Add server"
        :disabled="!isOwner"
        @click="openModal(null)"
      />
    </template>
    <p class="mb-3 max-w-3xl text-xs leading-relaxed text-muted">
      <template v-if="projectId">
        Tools the agent gets in this project, on top of the global servers from Settings → Agent.
      </template>
      <template v-else>
        Tools the agent gets in every project. A project can add its own or replace one by its name.
      </template>
    </p>

    <ul
      v-if="servers.length"
      class="flex flex-col divide-y divide-muted"
    >
      <li
        v-for="server in servers"
        :key="server.id"
        class="flex items-center gap-3 py-2.5"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm text-highlighted">
            {{ server.name }}
          </div>
          <div class="k-mono truncate text-2xs text-dimmed">
            {{ describe(server) }}
          </div>
        </div>
        <UTooltip text="Test connection">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-activity"
            aria-label="Test connection"
            :loading="testing === server.id"
            :disabled="!isOwner"
            @click="test(server)"
          />
        </UTooltip>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-pencil"
          aria-label="Edit"
          :disabled="!isOwner"
          @click="openModal(server)"
        />
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-trash-2"
          aria-label="Delete"
          :disabled="!isOwner"
          @click="deleting = server"
        />
        <USwitch
          :model-value="server.enabled"
          :aria-label="server.enabled ? 'Disable' : 'Enable'"
          :disabled="!isOwner"
          @update:model-value="setEnabled(server, $event)"
        />
      </li>
    </ul>
    <p
      v-else
      class="text-xs text-dimmed"
    >
      No MCP servers yet.
    </p>

    <div
      v-if="projectId && data?.global.length"
      class="mt-4"
    >
      <div class="mb-1.5 text-2xs uppercase tracking-wide text-dimmed">
        Global
      </div>
      <ul class="flex flex-col gap-1">
        <li
          v-for="server in data.global"
          :key="server.id"
          class="flex items-center gap-2 text-xs"
          :class="ownNames.has(server.name) || !server.enabled ? 'text-dimmed line-through' : 'text-muted'"
        >
          <span>{{ server.name }}</span>
          <span class="k-mono truncate text-2xs text-dimmed">{{ describe(server) }}</span>
          <span
            v-if="ownNames.has(server.name)"
            class="text-2xs text-dimmed no-underline"
          >replaced here</span>
        </li>
      </ul>
    </div>

    <KMcpServerModal
      v-model:open="modalOpen"
      :project-id="projectId ?? null"
      :server="editing"
      @saved="refresh()"
    />
    <KConfirmModal
      v-model:open="confirmDelete"
      title="Delete the MCP server?"
      :description="deleting ? `The agent loses the tools of ${deleting.name}.` : ''"
      detail="Its stored secrets are deleted with it."
      @confirm="remove"
    />
  </KPanel>
</template>
