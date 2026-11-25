<script setup lang="ts">
import type { EnvState, EnvTransition } from '#shared/utils/run'
import { useToastError } from '~/composables/useToastError'
import { computed, ref } from 'vue'
import { $fetch } from '#imports'
import KEnvLifecycle from '~/components/KEnvLifecycle.vue'
import KPreviewBrowser from '~/components/KPreviewBrowser.vue'

const props = defineProps<{
  runId: number
  workflowId: number | null
  sessionId: number
  previewHosts: string[]
  hasPreviewTarget: boolean
  envState: EnvState
  hasEnv: boolean
  previewLost: boolean
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
const reviving = computed(() => props.busy === 'booting' || props.busy === 'rebooting' || props.busy === 'restoring')

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

const restarting = ref(false)
async function runAgain() {
  if (!props.workflowId) return
  restarting.value = true
  try {
    const created = await $fetch(`/api/runs/${props.runId}/again`, { method: 'POST' })
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
    <template #actions>
      <slot name="actions" />
    </template>
    <KEnvLifecycle
      :env-state="envState"
      :workflow-id="workflowId"
      :preview-lost="previewLost"
      :reviving="reviving"
      :restarting="restarting"
      @revive="reboot"
      @run-again="runAgain"
    />
  </KPreviewBrowser>
</template>
