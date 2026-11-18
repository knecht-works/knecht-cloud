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
const workflowId = ref<number | null>(null)
const query = ref('')

const filteredWorkflows = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return startableWorkflows.value
  return startableWorkflows.value.filter(w =>
    w.name.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q))
})

const submitLabel = computed(() => {
  if (workflowId.value !== null) return 'Run workflow'
  return withPreview.value ? 'Start with preview' : 'Start with code only'
})

const { starting, start, startSession } = useStartRun(props.project.id, (runId) => {
  open.value = false
  return emit('runStarted', runId)
})

function submit() {
  return workflowId.value === null
    ? startSession(selectedBranch.value, withPreview.value)
    : start(workflowId.value, selectedBranch.value)
}

watch(open, (isOpen) => {
  if (isOpen) return
  workflowId.value = null
  query.value = ''
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="Start session"
    :description="project.fullName"
    :ui="{ content: 'max-w-lg' }"
  >
    <template #body>
      <div class="flex flex-col gap-5">
        <UFormField label="Branch">
          <USelectMenu
            v-model="selectedBranch"
            :items="branchItems"
            icon="i-lucide-git-branch"
            :search-input="{ placeholder: 'Filter branches…' }"
            class="w-full"
          />
        </UFormField>

        <div
          class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
          :class="workflowId === null ? 'border-(--primary-border) bg-(--surface-glass)' : 'border-default hover:bg-(--surface-glass)'"
          @click="workflowId = null"
        >
          <UIcon
            name="i-lucide-terminal"
            class="mt-0.5 size-4 flex-none text-primary"
          />
          <span class="min-w-0 flex-1">
            <span class="block text-sm text-highlighted">Session only</span>
            <span class="mt-0.5 block text-xs leading-relaxed text-muted">
              No workflow. Boot a preview with the database, dev server and boot commands, or check out the code only.
            </span>
          </span>
          <span class="flex flex-none items-center gap-2">
            <span class="text-2xs text-dimmed">Preview</span>
            <USwitch
              v-model="withPreview"
              aria-label="Boot a preview"
            />
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm text-highlighted">Or run a workflow</span>
            <span class="text-2xs text-dimmed">{{ startableWorkflows.length }} available</span>
          </div>
          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Search workflows…"
            aria-label="Search workflows"
            class="w-full"
          />
          <div class="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-lg border border-default p-1">
            <button
              v-for="w in filteredWorkflows"
              :key="w.id"
              type="button"
              class="flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors"
              :class="workflowId === w.id ? 'bg-(--surface-glass) ring-1 ring-(--primary-border)' : 'hover:bg-(--surface-glass)'"
              @click="workflowId = w.id"
              @dblclick="submit"
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
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="open = false"
        />
        <UButton
          color="primary"
          :label="submitLabel"
          :loading="starting"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
