<script setup lang="ts">
const toast = useToast()

const { data: workflows } = await useFetch('/api/workflows')
const { data: projects } = await useFetch('/api/projects', {
  transform: rows => rows.map(p => ({ ...p, label: p.fullName })),
})

const selectedWorkflow = ref<string>()
const selectedProject = ref()
const running = ref(false)

// Default to the first (only) bundled workflow so the common path is one click.
watchEffect(() => {
  if (!selectedWorkflow.value && workflows.value?.length) {
    selectedWorkflow.value = workflows.value[0]!.name
  }
})

const canRun = computed(() => !!selectedWorkflow.value && !!selectedProject.value)

async function run() {
  if (!canRun.value) return
  running.value = true
  try {
    const created = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: selectedProject.value!.id, workflow: selectedWorkflow.value },
    })
    await navigateTo(`/runs/${created.id}`)
  }
  catch (e) {
    toast.add({
      title: 'Failed to start run',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
  finally {
    running.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Workflows">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-2xl space-y-6">
        <p class="text-sm text-muted">
          Pick a workflow and a project, then run it. The booted environment
          becomes previewable on the run page.
        </p>

        <UCard>
          <div class="space-y-4">
            <UFormField
              label="Workflow"
              required
            >
              <USelect
                v-model="selectedWorkflow"
                :items="(workflows ?? []).map(w => ({ label: w.name, value: w.name }))"
                placeholder="Select a workflow…"
                class="w-full"
              />
              <template #help>
                <span class="text-muted">
                  {{ workflows?.find(w => w.name === selectedWorkflow)?.description }}
                </span>
              </template>
            </UFormField>

            <UFormField
              label="Project"
              required
            >
              <USelectMenu
                v-model="selectedProject"
                :items="projects ?? []"
                placeholder="Select a project…"
                icon="i-lucide-folder-git-2"
                class="w-full"
              />
              <template
                v-if="!projects?.length"
                #help
              >
                <span class="text-muted">
                  No projects yet — connect a repo first.
                </span>
              </template>
            </UFormField>

            <div class="flex justify-end">
              <UButton
                label="Run"
                icon="i-lucide-play"
                :loading="running"
                :disabled="!canRun"
                @click="run"
              />
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
