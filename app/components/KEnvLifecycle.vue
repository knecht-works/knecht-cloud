<script setup lang="ts">
import type { EnvState } from '#shared/utils/run'

defineProps<{
  envState: EnvState
  workflowId: number | null
  reviving: boolean
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
