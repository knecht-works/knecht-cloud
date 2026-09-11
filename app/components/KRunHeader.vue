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

async function envAction(action: 'stop' | 'archive') {
  emit('pending', action === 'stop' ? 'stopping' : 'archiving')
  try {
    await $fetch(`/api/runs/${props.runId}/${action}`, { method: 'POST' })
    emit('changed')
  }
  catch (e) {
    toastError(action === 'stop' ? 'Stop failed' : 'Archive failed', e)
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

const menuItems = computed(() => {
  const remote = props.envState !== 'down'
    ? [{
        label: 'Terminal',
        icon: 'i-lucide-square-terminal',
        disabled: !canTerminal.value,
        onSelect: () => emit('openTerminal'),
      }]
    : []
  const lifecycle = props.envState === 'up' && !props.isLive
    ? [{ label: 'Stop environment', icon: 'i-lucide-power-off', disabled: !!props.busy, onSelect: () => envAction('stop') }]
    : props.envState === 'stopped'
      ? [{ label: 'Archive environment', icon: 'i-lucide-archive', disabled: !!props.busy, onSelect: () => envAction('archive') }]
      : []
  return [remote, lifecycle, [{
    label: 'Delete run',
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => { confirmDelete.value = true },
  }]]
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2.5">
          <h2 class="k-mono text-lg font-semibold tracking-tight text-highlighted">
            Run #{{ runId }}
          </h2>
          <KStatusDot
            :color="statusMeta.dot"
            :pulse="statusMeta.pulse"
            :size="6"
          />
          <span
            class="k-mono text-2xs uppercase tracking-widest"
            :style="{ color: statusMeta.text }"
          >{{ statusMeta.label }}</span>
        </div>
        <div
          v-if="meta.length"
          class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <component
            :is="m.href ? NuxtLink : 'span'"
            v-for="m in meta"
            :key="m.icon"
            :href="m.href"
            :target="m.href?.startsWith('http') ? '_blank' : undefined"
            class="flex items-center gap-1.5 text-dimmed"
            :class="m.href ? 'transition-colors hover:text-muted' : ''"
          >
            <UIcon
              :name="m.icon"
              class="size-3.5"
            />
            <span class="k-mono text-xs text-muted">{{ m.text }}</span>
          </component>
        </div>
      </div>
      <div class="flex flex-none items-center gap-2">
        <UButton
          v-if="!isLive && envState !== 'down'"
          color="neutral"
          variant="outline"
          icon="i-lucide-code"
          label="Open in IDE"
          :disabled="!canTerminal"
          @click="openInVscode"
        />
        <UButton
          v-if="prUrl"
          color="primary"
          icon="i-lucide-git-pull-request"
          label="Open Pull Request"
          :to="prUrl"
          target="_blank"
        />
        <UButton
          v-if="isLive"
          color="error"
          variant="outline"
          label="Cancel run"
          :loading="cancelling"
          @click="cancel"
        />
        <UButton
          v-else-if="status === 'cancelled' && kind !== 'mention'"
          color="primary"
          icon="i-lucide-play"
          label="Retry"
          :loading="retrying"
          @click="retry"
        />
        <UDropdownMenu
          :items="menuItems"
          :content="{ align: 'end' }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ellipsis-vertical"
            aria-label="More actions"
          />
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
