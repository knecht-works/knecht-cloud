<script setup lang="ts">
// Only mounts when logged in (gated by the parent), so this fetch — and the
// requireUserSession on /api/system — never runs for anonymous visitors.
// Shared with the sidebar's system card: one probe per app load.
const { data, status, error, refresh } = useSystemInfo()
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
