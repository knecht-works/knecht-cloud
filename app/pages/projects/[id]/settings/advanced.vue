<script setup lang="ts">
import { useToast, useRoute, navigateTo, $fetch } from '#imports'
import { useToastError } from '~/composables/useToastError'
import { useProject } from '~/composables/useProjects'
import { useRuns } from '~/composables/useRuns'
import { useBranchPicker } from '~/composables/useBranchPicker'
import { useAutosave } from '~/composables/useAutosave'
import { computed, ref, watch } from 'vue'
import KSaveStatus from '~/components/KSaveStatus.vue'
import KSettingsPreviews from '~/components/KSettingsPreviews.vue'
import KSettingRow from '~/components/KSettingRow.vue'
import KPanel from '~/components/KPanel.vue'
import KConfirmModal from '~/components/KConfirmModal.vue'
import { UButton, USelectMenu } from '#components'

const toast = useToast()
const toastError = useToastError()
const id = Number(useRoute().params.id)

const { data: project } = await useProject(id)
const { data: runs } = useRuns(id)
const activeRunCount = computed(() =>
  (runs.value ?? []).filter(r => r.status === 'running' || r.status === 'queued').length)

const defaultBranch = ref(project.value?.defaultBranch ?? '')
const { items: branchItems } = useBranchPicker(
  () => `/api/projects/${id}/branches`,
  () => project.value?.defaultBranch,
)
const { state: branchState, error: branchError, schedule: scheduleBranch } = useAutosave(async () => {
  const body = { defaultBranch: defaultBranch.value }
  try {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body })
  }
  catch (e) {
    defaultBranch.value = project.value?.defaultBranch ?? ''
    throw e
  }
  if (project.value) project.value = { ...project.value, ...body }
}, 0)
watch(defaultBranch, (branch) => {
  if (branch === project.value?.defaultBranch) return
  scheduleBranch()
})

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
      title="Repository"
      icon="i-lucide-git-branch"
      accent="var(--primary)"
    >
      <template #action>
        <KSaveStatus
          v-if="branchState !== 'idle'"
          :state="branchState"
          :error-text="branchError"
        />
      </template>
      <KSettingRow
        label="Default branch"
        hint="New sessions start from this branch and their pull requests target it, unless a trigger picks another. Open sessions keep the branch they started from."
      >
        <USelectMenu
          v-model="defaultBranch"
          :items="branchItems"
          icon="i-lucide-git-branch"
          :search-input="{ placeholder: 'Filter branches…' }"
          class="w-full"
        />
      </KSettingRow>
    </KPanel>
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
