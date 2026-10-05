<script setup lang="ts">
const props = defineProps<{
  project: {
    id: number
    fullName: string
    defaultBranch: string
  }
}>()

const emit = defineEmits<{ runStarted: [runId: number] }>()

const { data: workflowList } = useFetch('/api/workflows', { default: () => [], lazy: true })
const startableWorkflows = computed(() => (workflowList.value ?? []).filter(workflowRunnable))
const startOpen = ref(false)

const selectedBranch = ref(props.project.defaultBranch)
const { items: branchItems } = useBranchPicker(
  () => `/api/projects/${props.project.id}/branches`,
  () => props.project.defaultBranch,
)

const { starting, start } = useStartRun(props.project.id, runId => emit('runStarted', runId))
function startWorkflow(workflowId: number) {
  startOpen.value = false
  return start(workflowId, selectedBranch.value)
}

const route = useRoute()
const onSettings = computed(() => route.path.startsWith(`/projects/${props.project.id}/settings`))
</script>

<template>
  <div class="flex min-h-10 items-center justify-between gap-4">
    <slot name="breadcrumb" />
    <div class="flex flex-none items-center gap-2.5">
      <UPopover
        v-model:open="startOpen"
        :content="{ side: 'bottom', align: 'end' }"
      >
        <UTooltip
          text="Run a workflow on this project"
          :disabled="startOpen"
        >
          <UButton
            color="primary"
            label="Start workflow"
            :loading="starting"
          />
        </UTooltip>
        <template #content>
          <div class="w-72 p-3">
            <div class="k-label mb-1.5">
              Branch
            </div>
            <USelectMenu
              v-model="selectedBranch"
              :items="branchItems"
              icon="i-lucide-git-branch"
              :search-input="{ placeholder: 'Filter branches…' }"
              class="w-full"
            />

            <div class="k-label mb-1.5 mt-3.5">
              Workflow
            </div>
            <div
              v-if="startableWorkflows.length"
              class="flex flex-col gap-0.5"
            >
              <button
                v-for="w in startableWorkflows"
                :key="w.id"
                type="button"
                class="flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-(--surface-glass) disabled:cursor-default"
                :disabled="starting"
                @click="startWorkflow(w.id)"
              >
                <UIcon
                  name="i-lucide-workflow"
                  class="mt-0.5 size-4 flex-none text-primary"
                />
                <span class="min-w-0">
                  <span class="k-mono block truncate text-xs text-default">{{ w.name }}</span>
                  <span
                    v-if="w.description"
                    class="block truncate text-2xs text-dimmed"
                  >{{ w.description }}</span>
                </span>
              </button>
            </div>
            <p
              v-else
              class="px-2.5 py-2 text-xs text-dimmed"
            >
              No workflows yet.
            </p>
          </div>
        </template>
      </UPopover>
      <UTooltip :text="onSettings ? 'Project' : 'Settings'">
        <UButton
          :to="onSettings ? `/projects/${project.id}` : `/projects/${project.id}/settings`"
          color="neutral"
          variant="outline"
          :icon="onSettings ? 'i-lucide-box' : 'i-lucide-settings'"
          :aria-label="onSettings ? 'Back to project' : 'Project settings'"
          class="size-10 justify-center"
        />
      </UTooltip>
    </div>
  </div>
</template>
