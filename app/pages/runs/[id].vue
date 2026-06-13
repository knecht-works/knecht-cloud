<script setup lang="ts">
const route = useRoute()
const toast = useToast()
const id = Number(route.params.id)

const { data: run, refresh } = await useFetch(`/api/runs/${id}`)

const statusColor = {
  queued: 'neutral',
  running: 'info',
  success: 'success',
  failed: 'error',
} as const

const isLive = computed(() => run.value?.status === 'queued' || run.value?.status === 'running')

// The preview lives on its own per-run origin (<runId>.preview.<host>) so the
// app's absolute asset paths resolve. The host mirrors how you reached Knecht
// (e.g. lvh.me:3000 → <runId>.preview.lvh.me:3000), so the session cookie is
// shared and the proxy can gate access.
const reqUrl = useRequestURL()
const previewUrl = computed(() =>
  run.value ? `${reqUrl.protocol}//${run.value.id}.preview.${reqUrl.host}/` : '',
)

const deleting = ref(false)
async function remove() {
  deleting.value = true
  try {
    await $fetch(`/api/runs/${id}`, { method: 'DELETE' })
    await navigateTo('/runs')
  }
  catch (e) {
    deleting.value = false
    toast.add({
      title: 'Delete failed',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
}

const rebooting = ref(false)
async function reboot() {
  rebooting.value = true
  try {
    run.value = await $fetch(`/api/runs/${id}/reboot`, { method: 'POST' })
  }
  catch (e) {
    toast.add({
      title: 'Reboot failed',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
  finally {
    rebooting.value = false
  }
}

// Poll the run row while it's still live (SSE is deferred). Stops once the run
// reaches a terminal status.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (isLive.value) refresh()
    else if (timer) clearInterval(timer)
  }, 1500)
})
onUnmounted(() => timer && clearInterval(timer))
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="run ? `Run #${run.id}` : 'Run'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            to="/runs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            label="All runs"
          />
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            label="Delete"
            :loading="deleting"
            @click="remove"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        v-if="run"
        class="space-y-6"
      >
        <div class="flex items-center gap-3">
          <UBadge
            :color="statusColor[run.status]"
            variant="subtle"
          >
            {{ run.status }}
          </UBadge>
          <span class="text-sm text-muted">{{ run.workflow }} · {{ run.project }}</span>
        </div>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              Log
            </h2>
          </template>
          <pre class="max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">{{ run.log || '…' }}</pre>
        </UCard>

        <UCard v-if="run.envState !== 'down'">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">
                Preview
              </h2>
              <UButton
                v-if="run.envState === 'up'"
                :to="previewUrl"
                target="_blank"
                size="xs"
                variant="subtle"
                icon="i-lucide-external-link"
                label="Open in new tab"
              />
            </div>
          </template>

          <iframe
            v-if="run.envState === 'up'"
            :src="previewUrl"
            class="h-[600px] w-full rounded border border-default"
          />
          <div
            v-else
            class="flex items-center justify-between gap-4"
          >
            <p class="text-sm text-muted">
              Environment was stopped after being idle. Reboot it to preview again
              — the imported database and built files are kept.
            </p>
            <UButton
              label="Reboot"
              icon="i-lucide-power"
              :loading="rebooting"
              @click="reboot"
            />
          </div>

          <template
            v-if="run.envState === 'up'"
            #footer
          >
            <p class="text-xs text-muted">
              Served from {{ previewUrl }} — use "Open in new tab" if the frame
              is blank (some apps block embedding via CSP frame-ancestors).
            </p>
          </template>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
