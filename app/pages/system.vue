<script setup lang="ts">
// The host's engine room, reached through the sidebar's system card: docker
// daemon, ddev CLI and the knecht containers running on the host.
const toast = useToast()
const toastError = useToastError()

// Automatic updates: the toggle for the nightly self-update
// (server/plugins/auto-update.ts). Saved immediately; patchSettings merges
// the echo in place.
const { data: settings } = useSettings()
const autoUpdateSaving = ref(false)
async function toggleAutoUpdate() {
  if (!settings.value || autoUpdateSaving.value) return
  autoUpdateSaving.value = true
  try {
    await patchSettings(settings, { autoUpdate: !settings.value.autoUpdate })
  }
  finally {
    autoUpdateSaving.value = false
  }
}

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
      title="Automatic updates"
      icon="i-lucide-arrow-up-circle"
      accent="var(--primary)"
      class="mt-4.5"
    >
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p class="max-w-2xl text-2sm leading-relaxed text-muted">
          Installs new releases automatically, between 03:00 and 06:00 server time
          and only while no run is active.
        </p>
        <KToggle
          :active="settings?.autoUpdate ?? false"
          :disabled="!settings || autoUpdateSaving"
          aria-label="Automatic updates"
          class="flex-none"
          @toggle="toggleAutoUpdate()"
        />
      </div>
    </KPanel>

    <KPanel
      title="Cleanup"
      icon="i-lucide-trash-2"
      accent="var(--primary)"
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
