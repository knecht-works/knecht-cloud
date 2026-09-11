<script setup lang="ts">
import type { EnvState, EnvTransition } from '#shared/utils/run'

const props = defineProps<{
  runId: number
  projectId: number
  workflowId: number | null
  sessionId: number
  previewHosts: string[]
  hasPreviewTarget: boolean
  envState: EnvState
  hasEnv: boolean
  previewOnline: boolean
  isLive: boolean
  busy: EnvTransition | null
}>()

const emit = defineEmits<{
  changed: []
  pending: [transition: EnvTransition | null]
  started: [runId: number]
}>()

const toastError = useToastError()
const reviving = computed(() => props.busy === 'rebooting' || props.busy === 'restoring')

async function reboot() {
  const restoring = props.envState === 'archived'
  emit('pending', restoring ? 'restoring' : 'rebooting')
  try {
    await $fetch(`/api/runs/${props.runId}/reboot`, { method: 'POST' })
    emit('changed')
  }
  catch (e) {
    toastError(restoring ? 'Restore failed' : 'Reboot failed', e)
  }
  finally {
    emit('pending', null)
  }
}

// Deliberately not the run's own branch: a create-branch step overwrote it with the work branch.
const restarting = ref(false)
async function runAgain() {
  if (!props.workflowId) return
  restarting.value = true
  try {
    const created = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: props.projectId, workflowId: props.workflowId },
    })
    emit('started', created.id)
  }
  catch (e) {
    restarting.value = false
    toastError('Failed to start run', e)
  }
}
</script>

<template>
  <KPreviewBrowser
    v-if="hasEnv && hasPreviewTarget"
    :session-id="sessionId"
    :hosts="previewHosts"
    :online="previewOnline"
    :busy="busy ?? (isLive && !previewOnline ? 'booting' : null)"
  >
    <KEnvLifecycle
      :env-state="envState"
      :workflow-id="workflowId"
      :reviving="reviving"
      :restarting="restarting"
      @revive="reboot"
      @run-again="runAgain"
    />
  </KPreviewBrowser>
  <div
    v-else-if="hasEnv && envState !== 'up' && !isLive"
    class="k-card flex flex-col items-center gap-3 p-5 text-center"
  >
    <KEnvLifecycle
      :env-state="envState"
      :workflow-id="workflowId"
      :reviving="reviving"
      :restarting="restarting"
      @revive="reboot"
      @run-again="runAgain"
    />
  </div>
</template>
