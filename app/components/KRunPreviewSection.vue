<script setup lang="ts">
import type { EnvState } from '#shared/utils/run'

// The preview anchors the workspace whenever the workflow boots an env that
// serves something (a repo with its own ddev config, or a dev server on a
// preview port); a workflow without a boot step renders nothing. While the
// env is offline, its lifecycle state (stopped/archived/gone) renders inside
// the frame with its revival action, or as a plain card for a headless env
// (nothing to browse, so no frame at all).
const props = defineProps<{
  runId: number
  projectId: number
  workflowId: number | null
  sessionId: number
  previewHosts: string[]
  hasPreviewTarget: boolean
  envState: EnvState
  hasBootStep: boolean
  previewOnline: boolean
  isLive: boolean
}>()

const emit = defineEmits<{
  /** Reboot/restore changed the run's env state; the parent refreshes. */
  changed: []
  /** "Run again" created a fresh run; the parent selects it. */
  started: [runId: number]
}>()

const toastError = useToastError()

// Walk the env DOWN its lifecycle on demand (stop exports the database and
// frees the containers, archive snapshots and deletes the heavy sandbox);
// the reverse steps (reboot/restore) live here.
const rebooting = ref(false)
async function reboot() {
  rebooting.value = true
  try {
    await $fetch(`/api/runs/${props.runId}/reboot`, { method: 'POST' })
    emit('changed')
  }
  catch (e) {
    toastError(props.envState === 'archived' ? 'Restore failed' : 'Reboot failed', e)
  }
  finally {
    rebooting.value = false
  }
}

// Start the same workflow on the same project as a NEW run. A torn-down env
// ('down') can't be rebooted (its sandbox and checkout are gone), so re-running
// is the way to get a fresh preview. Deliberately does not reuse the run's own
// branch: a create-branch step overwrote it with the run's own work branch.
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
    v-if="hasBootStep && hasPreviewTarget"
    :session-id="sessionId"
    :hosts="previewHosts"
    :online="previewOnline"
    :booting="isLive"
  >
    <KEnvLifecycle
      :env-state="envState"
      :workflow-id="workflowId"
      :reviving="rebooting"
      :restarting="restarting"
      @revive="reboot"
      @run-again="runAgain"
    />
  </KPreviewBrowser>
  <div
    v-else-if="hasBootStep && envState !== 'up' && !isLive"
    class="k-card flex flex-col items-center gap-3 p-5 text-center"
  >
    <KEnvLifecycle
      :env-state="envState"
      :workflow-id="workflowId"
      :reviving="rebooting"
      :restarting="restarting"
      @revive="reboot"
      @run-again="runAgain"
    />
  </div>
</template>
