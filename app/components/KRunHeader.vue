<script setup lang="ts">
import type { EnvState, EnvTransition } from '#shared/utils/run'
import type { RunStatus, RunStatusMeta } from '~/utils/dashboard'

interface MetaChip { icon: string, text: string, href?: string }

const props = defineProps<{
  runId: number
  status: RunStatus
  kind: 'workflow' | 'mention'
  envState: EnvState
  busy: EnvTransition | null
  prUrl: string | null
  isLive: boolean
  statusMeta: RunStatusMeta
  meta: MetaChip[]
}>()

const emit = defineEmits<{
  changed: []
  deleted: []
  openTerminal: []
  pending: [transition: EnvTransition | null]
}>()

const toastError = useToastError()
const NuxtLink = resolveComponent('NuxtLink')

const canTerminal = computed(() => props.envState === 'up' && !props.busy)

const { data: services, refresh: refreshServices } = useFetch(`/api/runs/${props.runId}/services`, {
  lazy: true,
  default: () => [],
})
watch(canTerminal, up => up && refreshServices())
const KNOWN_SERVICES: Record<string, { label: string, icon: string }> = {
  mailpit: { label: 'Mailpit', icon: 'i-lucide-mail' },
  adminer: { label: 'Adminer', icon: 'i-lucide-database' },
  phpmyadmin: { label: 'phpMyAdmin', icon: 'i-lucide-database' },
}
const { retrying, retry } = useRunRetry(props.runId, () => emit('changed'))

const confirmDelete = ref(false)
const deleting = ref(false)
async function remove() {
  deleting.value = true
  try {
    await $fetch(`/api/runs/${props.runId}`, { method: 'DELETE' })
    emit('deleted')
  }
  catch (e) {
    deleting.value = false
    toastError('Delete failed', e)
  }
}

const cancelling = ref(false)
async function cancel() {
  cancelling.value = true
  try {
    await $fetch(`/api/runs/${props.runId}/cancel`, { method: 'POST' })
    emit('changed')
  }
  catch (e) {
    toastError('Cancel failed', e)
  }
  finally {
    cancelling.value = false
  }
}

const ENV_ACTIONS = {
  stop: { transition: 'stopping', error: 'Stop failed' },
  archive: { transition: 'archiving', error: 'Archive failed' },
  reboot: { transition: 'rebooting', error: 'Reboot failed' },
  restore: { transition: 'restoring', error: 'Restore failed' },
} as const satisfies Record<string, { transition: EnvTransition, error: string }>

async function envAction(action: keyof typeof ENV_ACTIONS) {
  emit('pending', ENV_ACTIONS[action].transition)
  try {
    await $fetch(`/api/runs/${props.runId}/${action === 'restore' ? 'reboot' : action}`, { method: 'POST' })
    emit('changed')
  }
  catch (e) {
    toastError(ENV_ACTIONS[action].error, e)
  }
  finally {
    emit('pending', null)
  }
}

// The tab opens synchronously (popup blockers kill windows opened after an
// await) and navigates once the server confirms the IDE is up.
async function openInVscode() {
  const tab = window.open('about:blank', '_blank')
  try {
    const { url } = await $fetch<{ url: string }>(`/api/runs/${props.runId}/ide`, { method: 'POST' })
    if (tab) tab.location.href = url
    else window.open(url, '_blank')
  }
  catch (e) {
    tab?.close()
    toastError('Could not open the IDE', e)
  }
}

const tools = computed(() => canTerminal.value
  ? services.value.map(s => ({
      label: KNOWN_SERVICES[s.label]?.label ?? s.label,
      icon: KNOWN_SERVICES[s.label]?.icon ?? 'i-lucide-app-window',
      url: s.url,
    }))
  : [])

const menuItems = computed(() => {
  const lifecycle = (props.envState === 'up' && !props.isLive
    ? [{ label: 'Stop environment', icon: 'i-lucide-power-off', action: 'stop' as const }]
    : props.envState === 'stopped'
      ? [
          { label: 'Reboot environment', icon: 'i-lucide-power', action: 'reboot' as const },
          { label: 'Archive environment', icon: 'i-lucide-archive', action: 'archive' as const },
        ]
      : props.envState === 'archived'
        ? [{ label: 'Restore environment', icon: 'i-lucide-archive-restore', action: 'restore' as const }]
        : []
  ).map(({ action, ...item }) => ({ ...item, disabled: !!props.busy, onSelect: () => envAction(action) }))
  const remove = [{
    label: 'Delete run',
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => { confirmDelete.value = true },
  }]
  return [lifecycle, remove].filter(group => group.length)
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-2">
        <div class="flex items-baseline gap-2.5">
          <UTooltip :text="statusMeta.label">
            <span
              role="img"
              :aria-label="statusMeta.label"
              class="flex self-center"
            >
              <KStatusDot
                :color="statusMeta.dot"
                :pulse="statusMeta.pulse"
                :size="8"
              />
            </span>
          </UTooltip>
          <h2 class="k-mono text-base/none font-semibold tracking-tight text-highlighted">
            Run #{{ runId }}
          </h2>
        </div>
        <div
          v-if="meta.length"
          class="flex flex-wrap items-baseline gap-x-4 gap-y-2"
        >
          <component
            :is="m.href ? NuxtLink : 'span'"
            v-for="m in meta"
            :key="m.icon"
            :href="m.href"
            :target="m.href?.startsWith('http') ? '_blank' : undefined"
            class="flex items-baseline gap-1.5 text-dimmed"
            :class="m.href ? 'transition-colors hover:text-muted' : ''"
          >
            <UIcon
              :name="m.icon"
              class="size-3.5 self-center"
            />
            <span class="k-mono text-xs/none text-muted">{{ m.text }}</span>
          </component>
        </div>
      </div>
      <div class="flex flex-none items-center gap-2">
        <UTooltip
          v-if="isLive"
          text="Cancel run"
        >
          <UButton
            color="error"
            variant="outline"
            icon="i-lucide-circle-stop"
            aria-label="Cancel run"
            size="sm"
            class="size-8 justify-center"
            :loading="cancelling"
            @click="cancel"
          />
        </UTooltip>
        <UTooltip
          v-else-if="status === 'cancelled' && kind !== 'mention'"
          text="Retry"
        >
          <UButton
            color="primary"
            icon="i-lucide-rotate-ccw"
            aria-label="Retry"
            size="sm"
            class="size-8 justify-center"
            :loading="retrying"
            @click="retry"
          />
        </UTooltip>
        <UTooltip
          v-if="prUrl"
          text="Open Pull Request"
        >
          <UButton
            color="primary"
            icon="i-lucide-git-pull-request"
            aria-label="Open Pull Request"
            size="sm"
            class="size-8 justify-center"
            :to="prUrl"
            target="_blank"
          />
        </UTooltip>
        <UTooltip
          v-if="!isLive && envState !== 'down'"
          text="Open in IDE"
        >
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-code"
            aria-label="Open in IDE"
            size="sm"
            class="size-8 justify-center"
            :disabled="!canTerminal"
            @click="openInVscode"
          />
        </UTooltip>
        <UTooltip
          v-for="t in tools"
          :key="t.url"
          :text="t.label"
        >
          <UButton
            color="neutral"
            variant="outline"
            :icon="t.icon"
            :aria-label="t.label"
            size="sm"
            class="size-8 justify-center"
            :to="t.url"
            target="_blank"
          />
        </UTooltip>
        <UTooltip
          v-if="envState !== 'down'"
          text="Terminal"
        >
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-square-terminal"
            aria-label="Terminal"
            size="sm"
            class="size-8 justify-center"
            :disabled="!canTerminal"
            @click="emit('openTerminal')"
          />
        </UTooltip>
        <UDropdownMenu
          :items="menuItems"
          :content="{ align: 'end' }"
        >
          <UTooltip text="More actions">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-ellipsis-vertical"
              aria-label="More actions"
              size="sm"
              class="size-8 justify-center"
            />
          </UTooltip>
        </UDropdownMenu>
      </div>
    </div>

    <KConfirmModal
      v-model:open="confirmDelete"
      title="Delete run"
      :description="`Deletes run #${runId} including its log and preview environment. This cannot be undone.`"
      confirm-label="Delete"
      :loading="deleting"
      @confirm="remove"
    />
  </div>
</template>
