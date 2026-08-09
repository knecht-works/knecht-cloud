<script setup lang="ts">
// The host's engine room, reached through the sidebar's system card: docker
// daemon, ddev CLI and the knecht containers running on the host.
const toast = useToast()
const toastError = useToastError()

// Cleanup: on-demand reconcile GC. Reclaims leftovers whose DB row is gone
// (orphaned sandboxes, checkouts, archives, dump folders) plus superseded DB
// dumps. It also runs hourly on its own; this button is the "do it now" path.
interface GcResult { total: number }
const runningGc = ref(false)
async function runGc() {
  runningGc.value = true
  try {
    const { total } = await $fetch<GcResult>('/api/gc', { method: 'POST' })
    toast.add({
      title: total ? `Reclaimed ${total} orphaned item${total === 1 ? '' : 's'}` : 'Nothing to clean up',
      color: 'success',
    })
  }
  catch (e) {
    toastError('Cleanup failed', e)
  }
  finally {
    runningGc.value = false
  }
}
</script>

<template>
  <div>
    <KTopBar
      title="System"
      sub="Host daemon, sandbox runtime and running containers."
    >
      <template #actions>
        <AppSearch />
      </template>
    </KTopBar>

    <SystemPanel />

    <KPanel
      title="Cleanup"
      icon="i-lucide-trash-2"
      class="mt-4.5"
    >
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p class="max-w-2xl text-2sm leading-relaxed text-muted">
          Reclaims leftovers whose run or project is already gone: orphaned sandboxes, checkouts,
          archives and dump folders, plus superseded database dumps. This runs
          automatically every hour; use the button to run it now.
        </p>
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="subtle"
          label="Run cleanup now"
          :loading="runningGc"
          class="flex-none"
          @click="runGc"
        />
      </div>
    </KPanel>
  </div>
</template>
