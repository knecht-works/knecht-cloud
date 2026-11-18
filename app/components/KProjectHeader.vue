<script setup lang="ts">
const props = defineProps<{
  project: {
    id: number
    fullName: string
    defaultBranch: string
  }
}>()

const emit = defineEmits<{ runStarted: [runId: number] }>()

const { data: workflowList } = useWorkflows()
const startableWorkflows = computed(() => (workflowList.value ?? []).filter(workflowRunnable))
const startOpen = ref(false)

const selectedBranch = ref(props.project.defaultBranch)
const { items: branchItems } = useBranchPicker(
  () => `/api/projects/${props.project.id}/branches`,
  () => props.project.defaultBranch,
)

const withPreview = ref(true)

const { starting, start, startSession } = useStartRun(props.project.id, runId => emit('runStarted', runId))
function startWorkflow(workflowId: number) {
  startOpen.value = false
  return start(workflowId, selectedBranch.value)
}
function startPlainSession() {
  startOpen.value = false
  return startSession(selectedBranch.value, withPreview.value)
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
          text="Open a session on this project, with or without a workflow"
          :disabled="startOpen"
        >
          <UButton
            size="lg"
            color="primary"
            label="Start session"
            :loading="starting"
          />
        </UTooltip>
        <template #content>
          <div class="flex w-72 flex-col gap-4 p-3">
            <UFormField label="Branch">
              <USelectMenu
                v-model="selectedBranch"
                :items="branchItems"
                icon="i-lucide-git-branch"
                :search-input="{ placeholder: 'Filter branches…' }"
                class="w-full"
              />
            </UFormField>

            <div class="flex flex-col gap-3 rounded-lg border border-default p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm text-highlighted">
                    Boot a preview
                  </div>
                  <p class="mt-0.5 text-xs leading-relaxed text-muted">
                    Database, dev server and boot commands. Off: code only, faster.
                  </p>
                </div>
                <USwitch
                  v-model="withPreview"
                  aria-label="Boot a preview"
                  class="mt-0.5"
                />
              </div>
              <UButton
                color="primary"
                variant="soft"
                block
                :label="withPreview ? 'Start with preview' : 'Start with code only'"
                :disabled="starting"
                @click="startPlainSession"
              />
            </div>

            <UFormField label="Or run a workflow">
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
            </UFormField>
          </div>
        </template>
      </UPopover>
      <UTooltip :text="onSettings ? 'Project' : 'Settings'">
        <UButton
          size="lg"
          :to="onSettings ? `/projects/${project.id}` : `/projects/${project.id}/settings`"
          color="neutral"
          variant="outline"
          :icon="onSettings ? 'i-lucide-box' : 'i-lucide-settings'"
          :aria-label="onSettings ? 'Back to project' : 'Project settings'"
        />
      </UTooltip>
    </div>
  </div>
</template>
