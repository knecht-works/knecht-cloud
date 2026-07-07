<script setup lang="ts">
// Only mounts when logged in (gated by the parent), so this fetch (and the
// requireUserSession on /api/system) never runs for anonymous visitors.
// Shared with the sidebar's system card: one probe per app load.
const { data, status, error, refresh } = useSystemInfo()

// Self-update: kick off the updater, then poll until the recreated container
// answers with the target version (fetches fail while it restarts; that's
// expected) and reload into the new build.
const updating = ref(false)
const updateError = ref('')
const updateStale = ref(false)

async function runUpdate() {
  const target = data.value?.version.latest
  if (!target || updating.value) return
  updating.value = true
  updateError.value = ''
  try {
    await $fetch('/api/system/update', { method: 'POST' })
  }
  catch (err) {
    updating.value = false
    updateError.value = (err as { data?: { message?: string } }).data?.message || 'Update failed to start.'
    return
  }
  const startedAt = Date.now()
  const poll = setInterval(async () => {
    try {
      const info = await $fetch('/api/system')
      if (info.version.current === target) {
        clearInterval(poll)
        location.reload()
      }
    }
    catch { /* container is restarting */ }
    if (Date.now() - startedAt > 2 * 60 * 1000) updateStale.value = true
  }, 5000)
}
</script>

<template>
  <KPanel
    title="Host · Sandbox"
    icon="i-lucide-server"
    accent="var(--text-primary)"
  >
    <template #action>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </template>

    <div
      v-if="status === 'pending'"
      class="k-mono text-[12px] text-(--text-dimmed)"
    >
      Loading system info…
    </div>
    <div
      v-else-if="error"
      class="k-mono text-[12px] text-(--status-error)"
    >
      {{ error.message }}
    </div>
    <div
      v-else-if="data"
      class="grid grid-cols-1 gap-8 lg:grid-cols-2"
    >
      <div>
        <span class="k-label">System</span>
        <div class="mt-2.5 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="k-mono text-[12px] text-(--text-dimmed)">knecht</span>
            <span class="k-mono text-[12px] text-(--text-toned)">{{ data.version.current }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="k-mono text-[12px] text-(--text-dimmed)">docker</span>
            <span class="k-mono text-[12px] text-(--text-toned)">{{ data.dockerVersion }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="k-mono text-[12px] text-(--text-dimmed)">sysbox</span>
            <span
              class="k-mono text-[12px]"
              :class="data.sysboxAvailable ? 'text-(--text-toned)' : 'text-(--status-error)'"
            >{{ data.sysboxAvailable ? 'available' : 'missing' }}</span>
          </div>
          <div
            v-if="data.version.updateAvailable"
            class="flex flex-col gap-2"
          >
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              icon="i-lucide-arrow-up-circle"
              :loading="updating"
              class="self-start"
              @click="runUpdate()"
            >
              {{ updating ? `Updating to ${data.version.latest}…` : `Update to ${data.version.latest}` }}
            </UButton>
            <span
              v-if="updateError"
              class="k-mono text-[11.5px] text-(--status-error)"
            >{{ updateError }}</span>
            <span
              v-if="updateStale"
              class="k-mono text-[11.5px] text-(--text-dimmed)"
            >Still updating. Check `docker logs knecht-updater` on the server.</span>
          </div>
        </div>
      </div>
      <div class="lg:border-l lg:border-(--border-muted) lg:pl-8">
        <span class="k-label">Host containers · {{ data.hostContainers.length }}</span>
        <div class="mt-2.5 flex flex-col gap-2">
          <div
            v-for="name in data.hostContainers"
            :key="name"
            class="flex items-center gap-2"
          >
            <KStatusDot
              color="primary"
              :size="5"
            />
            <span class="k-mono text-[11.5px] text-(--text-muted)">{{ name }}</span>
          </div>
          <span
            v-if="!data.hostContainers.length"
            class="k-mono text-[11.5px] text-(--text-dimmed)"
          >None running.</span>
        </div>
      </div>
    </div>
  </KPanel>
</template>
