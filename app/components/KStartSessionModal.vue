<script setup lang="ts">
import { useWorkflows } from '~/composables/useWorkflows'
import { computed, ref, watch } from 'vue'
import { workflowRunnable } from '~/utils/workflow-steps'
import { useBranchPicker } from '~/composables/useBranchPicker'
import { useStartRun } from '~/composables/useStartRun'

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
    title="Start session"
    description="Work on a branch yourself, or let a workflow do it."
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField label="Branch">
          <USelectMenu
            v-model="selectedBranch"
            :items="branchItems"
            icon="i-lucide-git-branch"
            :search-input="{ placeholder: 'Filter branches…' }"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-4 rounded-lg border border-default p-4">
            <div>
              <div class="text-sm font-medium text-highlighted">
                Session
              </div>
              <p class="mt-0.5 text-xs text-muted">
                Work on the branch yourself.
              </p>
            </div>
            <div class="flex items-center justify-between gap-4 rounded-md bg-(--surface-glass) px-3 py-2.5">
              <div class="min-w-0">
                <div class="text-sm text-default">
                  Boot a preview
                </div>
                <p class="text-xs text-muted">
                  Off checks out the code only.
                </p>
              </div>
              <USwitch
                v-model="withPreview"
                aria-label="Boot a preview"
              />
            </div>
            <UButton
              color="primary"
              size="lg"
              block
              class="mt-auto"
              :label="withPreview ? 'Start with preview' : 'Start with code only'"
              :loading="starting"
              @click="startSession(selectedBranch, withPreview)"
            />
          </div>

          <div class="flex flex-col gap-4 overflow-hidden rounded-lg border border-default p-4">
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
            <div class="-mx-4 -mt-2 -mb-4 flex h-44 flex-col gap-0.5 overflow-y-auto pb-2 pl-2 [scrollbar-gutter:stable]">
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
                <UIcon
                  name="i-lucide-play"
                  class="size-3.5 flex-none text-dimmed opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                />
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
      </div>
    </template>
  </UModal>
</template>
