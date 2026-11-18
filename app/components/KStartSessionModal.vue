<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })
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

const selectedBranch = ref(props.project.defaultBranch)
const { items: branchItems } = useBranchPicker(
  () => `/api/projects/${props.project.id}/branches`,
  () => props.project.defaultBranch,
)

const withPreview = ref(true)
const query = ref('')

const filteredWorkflows = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return startableWorkflows.value
  return startableWorkflows.value.filter(w =>
    w.name.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q))
})

const { starting, start, startSession } = useStartRun(props.project.id, (runId) => {
  open.value = false
  return emit('runStarted', runId)
})

watch(open, (isOpen) => {
  if (!isOpen) query.value = ''
})
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #title>
      <span class="flex items-center gap-2">
        Start on
        <USelectMenu
          v-model="selectedBranch"
          :items="branchItems"
          icon="i-lucide-git-branch"
          size="sm"
          :search-input="{ placeholder: 'Filter branches…' }"
          aria-label="Branch"
          class="w-56"
        />
      </span>
    </template>
    <template #body>
      <div class="flex flex-col gap-5">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="text-sm font-medium text-highlighted">
              Session
            </div>
            <p class="mt-0.5 text-xs text-muted">
              Work on the branch yourself.
            </p>
          </div>
          <div class="flex items-center gap-4">
            <UTooltip text="Off checks out the code only">
              <span class="flex items-center gap-2 text-sm text-default">
                <USwitch
                  v-model="withPreview"
                  aria-label="Boot a preview"
                />
                Preview
              </span>
            </UTooltip>
            <UButton
              color="primary"
              label="Start session"
              :loading="starting"
              @click="startSession(selectedBranch, withPreview)"
            />
          </div>
        </div>

        <USeparator />

        <div class="flex flex-col gap-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-medium text-highlighted">
                Workflow
              </div>
              <p class="mt-0.5 text-xs text-muted">
                Let Knecht do the work.
              </p>
            </div>
            <span class="text-2xs text-dimmed">{{ startableWorkflows.length }} available</span>
          </div>
          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Search workflows…"
            aria-label="Search workflows"
            class="w-full"
          />
          <div class="-mx-2 flex h-56 flex-col gap-0.5 overflow-y-auto">
            <button
              v-for="w in filteredWorkflows"
              :key="w.id"
              type="button"
              class="group flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left ring-inset transition-colors hover:bg-(--surface-glass) focus-visible:outline-none disabled:cursor-default"
              :disabled="starting"
              @click="start(w.id, selectedBranch)"
            >
              <UIcon
                name="i-lucide-workflow"
                class="size-4 flex-none text-primary"
              />
              <span class="min-w-0 flex-1">
                <span class="k-mono block truncate text-xs text-default">{{ w.name }}</span>
                <span
                  v-if="w.description"
                  class="block truncate text-2xs text-dimmed"
                >{{ w.description }}</span>
              </span>
              <span class="flex flex-none items-center gap-1 text-2xs text-dimmed opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                Run
                <UIcon
                  name="i-lucide-play"
                  class="size-3"
                />
              </span>
            </button>
            <p
              v-if="!filteredWorkflows.length"
              class="px-2.5 py-2 text-xs text-dimmed"
            >
              {{ startableWorkflows.length ? 'No workflow matches.' : 'No workflows yet.' }}
            </p>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
