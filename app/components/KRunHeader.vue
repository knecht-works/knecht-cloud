<script setup lang="ts">
import type { EnvState, EnvTransition } from '#shared/utils/run'
import type { RunStatus } from '~/utils/dashboard'
import { useToastError } from '~/composables/useToastError'
import { computed, ref } from 'vue'
import { useRunServices } from '~/composables/useRuns'
import { useRunRetry } from '~/composables/useRunRetry'
import { $fetch } from '#imports'
import KConfirmModal from '~/components/KConfirmModal.vue'
import { UTooltip, UButton, UDropdownMenu } from '#components'

const props = defineProps<{
  runId: number
  sessionId: number
  projectId: number
  workflowId: number | null
  hasEnv: boolean
  status: RunStatus
  kind: 'workflow' | 'mention'
  envState: EnvState
  busy: EnvTransition | null
  prs: { url: string, label: string }[]
  isLive: boolean
}>()

const emit = defineEmits<{
  changed: []
  deleted: []
  openTerminal: []
  pending: [transition: EnvTransition | null]
  started: [runId: number]
}>()

const toastError = useToastError()

const canTerminal = computed(() => props.envState === 'up' && !props.busy)

const { data: services } = useRunServices(props.runId)
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

const restarting = ref(false)
async function runAgain() {
  restarting.value = true
  try {
    const created = await $fetch('/api/runs', { method: 'POST', body: { projectId: props.projectId, workflowId: props.workflowId } })
    emit('started', created.id)
  }
  catch (e) {
    toastError('Failed to start run', e)
  }
  finally {
    restarting.value = false
  }
}

const startingPreview = ref(false)
async function startPreview() {
  startingPreview.value = true
  try {
    const created = await $fetch(`/api/sessions/${props.sessionId}/preview`, { method: 'POST' })
    emit('started', created.id)
  }
  catch (e) {
    toastError('Failed to start the preview', e)
  }
  finally {
    startingPreview.value = false
  }
}

// The tab opens synchronously (popup blockers kill windows opened after an
// await) and navigates once the server confirms the IDE is up.
async function openInVscode() {
  const tab = window.open('about:blank', '_blank')
  // Opened before the await or the popup blocker steps in, so noopener cannot be passed:
  // the IDE host runs session code, which must not be able to redirect this tab.
  if (tab) tab.opener = null
  try {
    const { url } = await $fetch<{ url: string }>(`/api/runs/${props.runId}/ide`, { method: 'POST' })
    if (tab) tab.location.href = url
    else window.open(url, '_blank', 'noopener')
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
      to: s.url,
    }))
  : [])

const retryable = computed(() => (props.status === 'failed' || props.status === 'cancelled') && props.kind !== 'mention')

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
  const preview = !props.hasEnv && !props.isLive
    ? [{ label: 'Start preview', icon: 'i-lucide-monitor-play', disabled: startingPreview.value || !!props.busy, onSelect: startPreview }]
    : []
  const remove = [{
    label: 'Delete run',
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => { confirmDelete.value = true },
  }]
  const run = props.isLive
    ? [{ label: 'Cancel run', icon: 'i-lucide-square', color: 'error' as const, disabled: cancelling.value, onSelect: cancel }]
    : retryable.value
      ? [{ label: 'Resume from the failed step', icon: 'i-lucide-step-forward', disabled: retrying.value, onSelect: retry }]
      : []
  return [run, [...preview, ...lifecycle, ...remove]].filter(group => group.length)
})

interface PinnedAction {
  label: string
  icon: string
  disabled?: boolean
  onSelect?: () => void
  to?: string
  primary?: boolean
}

const pinned = computed<PinnedAction[]>(() => [
  ...(retryable.value && props.workflowId !== null
    ? [{ label: 'Run workflow again', icon: 'i-lucide-rotate-ccw', disabled: restarting.value, onSelect: runAgain, primary: true }]
    : []),
  ...props.prs.map(pr => ({ label: `Open ${pr.label}`, icon: 'i-lucide-git-pull-request', to: pr.url, primary: true })),
  ...(!props.isLive && props.envState !== 'down'
    ? [{ label: 'Open in IDE', icon: 'i-lucide-code-xml', disabled: !canTerminal.value, onSelect: openInVscode }]
    : []),
  ...tools.value,
  ...(props.envState !== 'down'
    ? [{ label: 'Terminal', icon: 'i-lucide-square-terminal', disabled: !canTerminal.value, onSelect: () => emit('openTerminal') }]
    : []),
])
</script>

<template>
  <div class="flex items-center gap-2">
    <UTooltip
      v-for="item in pinned"
      :key="item.label"
      :text="item.label"
    >
      <UButton
        :color="item.primary ? 'primary' : 'neutral'"
        :variant="item.primary ? 'solid' : 'subtle'"
        :icon="item.icon"
        :aria-label="item.label"
        :to="item.to"
        :target="item.to ? '_blank' : undefined"
        :disabled="item.disabled"
        size="sm"
        @click="item.onSelect?.()"
      />
    </UTooltip>
    <UDropdownMenu
      :items="menuItems"
      :content="{ align: 'end' }"
    >
      <UTooltip text="Session actions">
        <UButton
          color="neutral"
          variant="subtle"
          icon="i-lucide-ellipsis-vertical"
          aria-label="Session actions"
          size="sm"
        />
      </UTooltip>
    </UDropdownMenu>

    <KConfirmModal
      v-model:open="confirmDelete"
      title="Delete run"
      description="This cannot be undone."
      :detail="`Deletes run #${runId} including its log and preview environment.`"
      confirm-label="Delete"
      :loading="deleting"
      @confirm="remove"
    />
  </div>
</template>
