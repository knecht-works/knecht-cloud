<script setup lang="ts">
const toast = useToast()
const toastError = useToastError()
const id = Number(useRoute().params.id)

const { data: project } = await useFetch(`/api/projects/${id}`)
const { data: runs } = useFetch('/api/runs', { query: { projectId: id }, default: () => [], lazy: true })
const activeRunCount = computed(() =>
  (runs.value ?? []).filter(r => r.status === 'running' || r.status === 'queued').length)

const confirmDisconnect = ref(false)
const disconnectDescription = computed(() => {
  const active = activeRunCount.value
  const abort = active
    ? ` ${active === 1 ? '1 run is' : `${active} runs are`} still active and will be cancelled.`
    : ''
  return `Removes ${project.value?.fullName} from Knecht: all its runs, sessions and preview environments, uploaded DB dumps, shared folders and agent memory.${abort} The GitHub repo itself is not touched.`
})
const removing = ref(false)
async function removeProject() {
  removing.value = true
  try {
    await $fetch(`/api/projects/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Project disconnected', description: 'Its environments are being removed in the background.', color: 'success' })
    await navigateTo('/projects')
  }
  catch (e) {
    toastError('Failed to disconnect', e)
  }
  finally {
    removing.value = false
  }
}
</script>

<template>
  <div
    v-if="project"
    class="flex flex-col gap-4.5"
  >
    <KPanel
      title="Danger zone"
      icon="i-lucide-triangle-alert"
      accent="var(--status-error)"
      :pad="0"
    >
      <div class="divide-y divide-(--border-muted)">
        <div class="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div class="min-w-0">
            <div class="text-sm font-medium text-toned">
              Disconnect project
            </div>
            <p class="mt-1 max-w-140 text-xs leading-relaxed text-dimmed">
              Removes the project from Knecht with all its runs, sessions, preview environments,
              DB dumps, shared folders and agent memory. The GitHub repo is not touched.
            </p>
          </div>
          <UButton
            color="error"
            variant="outline"
            icon="i-lucide-unplug"
            label="Disconnect"
            @click="confirmDisconnect = true"
          />
        </div>
      </div>
    </KPanel>

    <KConfirmModal
      v-model:open="confirmDisconnect"
      title="Disconnect project"
      :description="disconnectDescription"
      confirm-label="Disconnect"
      :loading="removing"
      @confirm="removeProject"
    />
  </div>
</template>
