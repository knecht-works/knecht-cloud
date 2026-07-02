<script setup lang="ts">
// Only mounts when logged in (gated by the parent), so this fetch — and the
// requireUserSession on /api/system — never runs for anonymous visitors.
const { data, status, error, refresh } = await useFetch('/api/system')
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
      class="flex flex-col gap-3"
    >
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
      <div class="border-t border-(--border-muted) pt-3">
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
