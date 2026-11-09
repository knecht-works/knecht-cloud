<script setup lang="ts">
const toast = useToast()
const toastError = useToastError()
const id = Number(useRoute().params.id)

const { data: project } = await useProject(id)
const { data: runs } = useRuns(id)
const activeRunCount = computed(() =>
  (runs.value ?? []).filter(r => r.status === 'running' || r.status === 'queued').length)

const confirmDisconnect = ref(false)
const disconnectDetail = computed(() => {
  const active = activeRunCount.value
  const abort = active
    ? ` ${active === 1 ? '1 run is' : `${active} runs are`} still active and will be cancelled.`
    : ''
  return `Removes ${project.value?.fullName} from Knecht: all its runs, sessions and preview environments, uploaded DB dumps, shared folders and agent memory.${abort}`
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
    <KSettingsPreviews
      :project="project"
      editable
    />
    <KPanel
      title="Danger zone"
      icon="i-lucide-triangle-alert"
      accent="var(--status-error)"
    >
      <KSettingRow
        label="Disconnect project"
        hint="Removes the project from Knecht with all its runs, sessions, preview environments, DB dumps, shared folders and agent memory. The GitHub repo is not touched."
      >
        <div class="flex lg:justify-end">
          <UButton
            size="lg"
            color="error"
            label="Disconnect"
            @click="confirmDisconnect = true"
          />
        </div>
      </KSettingRow>
    </KPanel>

    <KConfirmModal
      v-model:open="confirmDisconnect"
      title="Disconnect project"
      description="This cannot be undone. The GitHub repo is not touched."
      :detail="disconnectDetail"
      confirm-label="Disconnect"
      :loading="removing"
      @confirm="removeProject"
    />
  </div>
</template>
