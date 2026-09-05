<script setup lang="ts">
// The header both project pages share (workspace and settings): favicon or
// framework icon, repo name, framework badge, GitHub link, and the actions
// that belong to the project rather than the page: "Start workflow" (branch
// + workflow picker) and the overflow menu with the destructive disconnect.
// The `nav` slot holds the one button that switches between the two pages.
const props = withDefaults(defineProps<{
  project: {
    id: number
    fullName: string
    defaultBranch: string
    private: boolean
    framework?: string | null
    frameworkVersion?: string | null
    favicon?: string | null
  }
  // Runs still executing or waiting: the disconnect aborts them, so the
  // confirm names them instead of hiding it in the generic list.
  activeRuns?: number
}>(), { activeRuns: 0 })

const emit = defineEmits<{ runStarted: [runId: number] }>()

const toast = useToast()
const toastError = useToastError()

const fw = computed(() => frameworkMeta(props.project.framework))
const fwLabel = computed(() =>
  props.project.frameworkVersion ? `${fw.value.label} ${props.project.frameworkVersion}` : fw.value.label)
const repoName = computed(() => props.project.fullName.split('/').pop() ?? 'Project')

// ── Start a workflow (picked from the list, right at the project) ──────────
const { data: workflowList } = useFetch('/api/workflows', { default: () => [], lazy: true })
// Manual runs execute the workflow's current state, so the picker offers
// every workflow that would pass the run validation (finish half-built ones
// in the editor first).
const startableWorkflows = computed(() => (workflowList.value ?? []).filter(workflowRunnable))
const startOpen = ref(false)

// Branch the run checks out; defaults to the repo's default branch (main). The
// list is fetched lazily from GitHub; the picker always includes the default.
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

// ── Disconnect (delete project + its runs, envs and checkouts) ─────────────
// Destructive, so it lives in the overflow menu behind a confirm.
const confirmDisconnect = ref(false)
const menuItems = [{
  label: 'Disconnect project',
  icon: 'i-lucide-trash-2',
  color: 'error' as const,
  onSelect: () => { confirmDisconnect.value = true },
}]
const disconnectDescription = computed(() => {
  const active = props.activeRuns
  const abort = active
    ? ` ${active === 1 ? '1 run is' : `${active} runs are`} still active and will be cancelled.`
    : ''
  return `Removes ${props.project.fullName} from Knecht: all its runs, sessions and preview environments, uploaded DB dumps, shared folders and agent memory.${abort} The GitHub repo itself is not touched.`
})
const removing = ref(false)
async function removeProject() {
  removing.value = true
  try {
    await $fetch(`/api/projects/${props.project.id}`, { method: 'DELETE' })
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
  <!-- One root so a page's margin class lands on the header. -->
  <div>
    <KPageHeader
      icon="i-lucide-box"
      :icon-color="fw.color"
      :favicon="project.favicon"
    >
      <h1 class="k-mono truncate text-2xl font-semibold tracking-tight text-highlighted">
        {{ repoName }}
      </h1>
      <template #meta>
        <span
          class="k-mono inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs tracking-wider"
          :style="{ color: fw.color, borderColor: 'color-mix(in oklab, currentColor 35%, transparent)' }"
        >{{ fwLabel }}</span>
        <a
          :href="`https://github.com/${project.fullName}`"
          target="_blank"
          rel="noopener"
          class="flex items-center gap-1.5 text-dimmed transition-colors hover:text-muted"
        >
          <UIcon
            name="i-simple-icons-github"
            class="size-3.5"
          />
          <span class="k-mono text-xs text-muted">{{ project.fullName }}</span>
        </a>
        <UBadge
          :color="project.private ? 'neutral' : 'primary'"
          variant="subtle"
          size="sm"
        >
          {{ project.private ? 'Private' : 'Public' }}
        </UBadge>
      </template>
      <template #actions>
        <slot name="nav" />
        <UPopover
          v-model:open="startOpen"
          :content="{ side: 'bottom', align: 'end' }"
        >
          <UButton
            color="primary"
            icon="i-lucide-play"
            trailing-icon="i-lucide-chevron-down"
            label="Start workflow"
            :loading="starting"
          />
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
        <UDropdownMenu
          :items="menuItems"
          :content="{ align: 'end' }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ellipsis-vertical"
            aria-label="More actions"
          />
        </UDropdownMenu>
      </template>
    </KPageHeader>

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
