<script setup lang="ts">
import type { EnvState } from '#shared/utils/run'

// The revival action for an environment that is not up: reboot a stopped
// one, restore an archived one, run the workflow again when it is gone. One
// component because the workspace renders it in two places: inside the
// preview frame's offline viewport, or as a plain card for a headless
// environment that has no frame.
defineProps<{
  envState: EnvState
  /** Null once the workflow was deleted: running again is impossible then. */
  workflowId: number | null
  /** A reboot/restore is in flight. */
  reviving: boolean
  /** A fresh run is being created. */
  restarting: boolean
}>()

defineEmits<{
  revive: []
  runAgain: []
}>()
</script>

<template>
  <template v-if="envState === 'stopped'">
    <p class="max-w-100 text-2sm text-muted">
      The environment is stopped. Reboot it to work in it again.
    </p>
    <UButton
      color="primary"
      label="Reboot"
      icon="i-lucide-power"
      :loading="reviving"
      @click="$emit('revive')"
    />
  </template>
  <template v-else-if="envState === 'archived'">
    <p class="max-w-100 text-2sm text-muted">
      This environment was archived. Its exact code state and database are kept,
      and restoring rebuilds it in a few minutes.
    </p>
    <UButton
      color="primary"
      label="Restore"
      icon="i-lucide-archive-restore"
      :loading="reviving"
      @click="$emit('revive')"
    />
  </template>
  <template v-else-if="envState === 'down'">
    <p class="max-w-100 text-2sm text-muted">
      This run's environment and its archive are gone, so there is nothing left to
      restore. Run the workflow again to get a fresh environment.
    </p>
    <UTooltip
      text="The workflow was deleted"
      :disabled="!!workflowId"
    >
      <UButton
        color="primary"
        label="Run again"
        icon="i-lucide-play"
        :loading="restarting"
        :disabled="!workflowId"
        @click="$emit('runAgain')"
      />
    </UTooltip>
  </template>
  <template v-else>
    <p class="max-w-70 text-2sm text-muted">
      The boot step didn't finish, so this run has no preview. Retry the run to boot it.
    </p>
  </template>
</template>
