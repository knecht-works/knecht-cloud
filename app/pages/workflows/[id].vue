<script setup lang="ts">
import { runWorkspacePath } from '#shared/utils/routes'
import { flattenSteps } from '#shared/utils/workflow'

const route = useRoute()
const toast = useToast()
const toastError = useToastError()

const id = computed(() => Number(route.params.id))

const { data: workflows, refresh } = await useFetch('/api/workflows', { default: () => [] })
const { data: projects } = useFetch('/api/projects', {
  default: () => [],
  lazy: true,
  transform: rows => rows.map(p => ({ ...p, label: p.fullName })),
})
const { data: allTriggers, refresh: refreshTriggers } = useFetch('/api/triggers', { default: () => [], lazy: true })

const saved = computed(() => workflows.value?.find(w => w.id === id.value) ?? null)
const notFound = computed(() => !saved.value)

const meta = reactive({ name: '', description: '' })
const metaOriginal = ref('')
const steps = ref<WorkflowStep[]>([])
const stepsOriginal = ref('')
const submitted = ref(false)
const openSteps = ref(new Set<WorkflowStep>())

function toggleStep(step: WorkflowStep) {
  if (openSteps.value.has(step)) openSteps.value.delete(step)
  else openSteps.value.add(step)
}

function revealStep(step: WorkflowStep) {
  openSteps.value.add(step)
  nextTick(() => document.getElementById(`step-card-${step.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
}

function stepWithId(stepId: string): WorkflowStep | undefined {
  return flattenSteps(steps.value).find(s => s.id === stepId)
}

onMounted(() => {
  const stepId = route.query.step
  if (typeof stepId !== 'string') return
  const step = stepWithId(stepId)
  if (step) revealStep(step)
})

function loadMeta() {
  meta.name = saved.value?.name ?? ''
  meta.description = saved.value?.description ?? ''
  metaOriginal.value = JSON.stringify({ ...meta })
}
function loadSteps() {
  const src = saved.value ? (saved.value.draftSteps ?? saved.value.steps) : []
  steps.value = structuredClone(toRaw(src)) as WorkflowStep[]
  stepsOriginal.value = JSON.stringify(steps.value)
  openSteps.value.clear()
  submitted.value = false
}
loadMeta()
loadSteps()
watch(id, () => {
  loadMeta()
  loadSteps()
})

const nameValid = computed(() => WORKFLOW_NAME_RE.test(meta.name.trim()))

const metaSave = useAutosave(async () => {
  await $fetch(`/api/workflows/${id.value}`, {
    method: 'PATCH',
    body: { name: meta.name.trim(), description: meta.description },
  })
  metaOriginal.value = JSON.stringify({ ...meta })
  await refresh()
})
watch(meta, () => {
  if (!saved.value || JSON.stringify({ ...meta }) === metaOriginal.value) return
  if (!nameValid.value) {
    return metaSave.invalid(meta.name.trim() ? 'Name: only letters, numbers, spaces, hyphens and underscores' : 'Give the workflow a name')
  }
  metaSave.schedule()
})

const stepsJson = computed(() => JSON.stringify(steps.value))
const draftSave = useAutosave(async () => {
  const json = stepsJson.value
  await $fetch(`/api/workflows/${id.value}`, {
    method: 'PATCH',
    body: { draftSteps: JSON.parse(json) },
  })
  stepsOriginal.value = json
})
watch(stepsJson, (json) => {
  if (!saved.value || json === stepsOriginal.value) return
  draftSave.schedule()
})

const saveState = computed(() => {
  if (metaSave.state.value === 'error' || draftSave.state.value === 'error') return 'error' as const
  if (metaSave.state.value === 'saving' || draftSave.state.value === 'saving') return 'saving' as const
  if (metaSave.state.value === 'saved' || draftSave.state.value === 'saved') return 'saved' as const
  return 'idle' as const
})
const saveErrorText = computed(() =>
  metaSave.state.value === 'error' ? metaSave.error.value : draftSave.error.value)

const hasIncompleteEdits = computed(() => !!saved.value?.draftSteps)

const { open, project, starting, activeRun, activeRunSteps, testBranch, testBranchItems, mockInputs, start, detach, retest, cancel, cancelling, retry, retrying }
  = useWorkflowTestRun<(typeof projects.value)[number]>(() => saved.value?.id, {
    beforeStart: () => draftSave.flush(),
    onStarted: () => openSteps.value.clear(),
  })

const mockOpen = ref(false)

const runPickerOpen = computed({
  get: () => open.value,
  set: (isOpen: boolean) => {
    if (isOpen && !valid.value) {
      submitted.value = true
      issuesOpen.value = true
      return
    }
    open.value = isOpen
  },
})

const editable = computed(() => !activeRun.value)

const workflowTriggers = computed(() =>
  saved.value ? (allTriggers.value ?? []).filter(t => t.workflowId === saved.value!.id) : [])
const projectChips = (names: string[]) => (names.length > 3 ? [...names.slice(0, 2), `+${names.length - 2}`] : names)
const triggerModalOpen = ref(false)
const editingTrigger = ref<(typeof workflowTriggers)['value'][number] | null>(null)

function editTrigger(t: (typeof workflowTriggers)['value'][number]) {
  editingTrigger.value = t
  triggerModalOpen.value = true
}
watch(triggerModalOpen, (isOpen) => {
  if (!isOpen) editingTrigger.value = null
})

async function toggleTrigger(t: { id: number, active: boolean }) {
  try {
    await $fetch(`/api/triggers/${t.id}`, { method: 'PATCH', body: { active: !t.active } })
    await refreshTriggers()
  }
  catch (e) {
    toastError('Failed to update trigger', e)
  }
}

async function removeTrigger(t: { id: number }) {
  try {
    await $fetch(`/api/triggers/${t.id}`, { method: 'DELETE' })
    await refreshTriggers()
    toast.add({ title: 'Trigger deleted', color: 'success' })
  }
  catch (e) {
    toastError('Failed to delete trigger', e)
  }
}

const togglingEnabled = ref(false)
async function toggleEnabled() {
  if (!saved.value || togglingEnabled.value) return
  const turningOn = !saved.value.enabled
  if (turningOn && !valid.value) {
    submitted.value = true
    issuesOpen.value = true
    return
  }
  togglingEnabled.value = true
  try {
    if (turningOn) await draftSave.flush()
    await $fetch(`/api/workflows/${id.value}`, {
      method: 'PATCH',
      body: { enabled: turningOn },
    })
    await refresh()
  }
  catch (e) {
    toastError('Failed to update workflow', e)
  }
  finally {
    togglingEnabled.value = false
  }
}

const confirmDelete = ref(false)

const menuItems = computed(() => [
  [{
    label: saved.value?.enabled ? 'Pause triggers' : 'Enable triggers',
    icon: saved.value?.enabled ? 'i-lucide-pause' : 'i-lucide-zap',
    disabled: togglingEnabled.value,
    onSelect: () => { void toggleEnabled() },
  }],
  (['yaml', 'json'] as const).map(format => ({
    label: `Export ${format.toUpperCase()}`,
    icon: 'i-lucide-file-down',
    disabled: !valid.value,
    onSelect: () => {
      if (saved.value) window.location.assign(`/api/workflows/${saved.value.id}/export?format=${format}`)
    },
  })),
  [
    ...(hasIncompleteEdits.value
      ? [{
          label: 'Discard incomplete edits',
          icon: 'i-lucide-undo-2',
          onSelect: () => { void discardDraft() },
        }]
      : []),
    {
      label: 'Delete workflow',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => { confirmDelete.value = true },
    },
  ],
])

function addStep(type: WorkflowStep['type']) {
  const step = makeStep(type, steps.value)
  steps.value.push(step)
  openSteps.value.add(steps.value.at(-1)!)
}

const { drag, startLibDrag, overList, overAt, performDrop, endDrag }
  = useWorkflowDnd(steps, openSteps, editable)

interface DraftIssue { target?: WorkflowStep, pristine: boolean, text: string }
const draftIssues = computed<DraftIssue[]>(() => {
  const list: DraftIssue[] = []
  if (!steps.value.length) {
    list.push({ pristine: true, text: 'Add at least one step' })
  }
  steps.value.forEach((step, i) => {
    for (const issue of stepIssues(step)) {
      const where = issue.step === step ? '' : ` › ${workflowStepMeta(issue.step).label}`
      list.push({
        target: step,
        pristine: stepPristine(issue.step),
        text: `Step ${i + 1} · ${workflowStepMeta(step).label}${where}: ${issue.message}`,
      })
    }
  })
  return list
})
const valid = computed(() => !draftIssues.value.length)
const flaggedIssues = computed(() => draftIssues.value.filter(i => submitted.value || !i.pristine))
provide(FORCE_STEP_ISSUES, submitted)

watch(valid, (ok) => {
  if (ok) submitted.value = false
})

const issuesOpen = ref(false)
function jumpToIssue(issue: DraftIssue) {
  issuesOpen.value = false
  if (issue.target) revealStep(issue.target)
}

async function discardDraft() {
  try {
    await draftSave.flush()
    await $fetch(`/api/workflows/${id.value}/discard`, { method: 'POST' })
    await refresh()
    loadSteps()
  }
  catch (e) {
    toastError('Failed to discard draft', e)
  }
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void draftSave.flush()
    void metaSave.flush()
  }
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (saveState.value === 'saving') e.preventDefault()
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})

const removing = ref(false)
async function removeWorkflow() {
  if (!saved.value) return
  removing.value = true
  try {
    const res = await $fetch<{ deletedTriggers: number }>(`/api/workflows/${id.value}`, { method: 'DELETE' })
    await refresh()
    toast.add({
      title: 'Workflow deleted',
      description: res.deletedTriggers ? `${res.deletedTriggers} trigger(s) removed with it` : undefined,
      color: 'success',
    })
    await navigateTo('/workflows')
  }
  catch (e) {
    toastError('Failed to delete', e)
  }
  finally {
    removing.value = false
  }
}

type Mode = 'draft' | 'edit' | 'running' | 'success' | 'failed'
const mode = computed<Mode>(() => {
  const run = activeRun.value
  if (run) {
    if (run.status === 'success') return 'success'
    if (run.status === 'failed') return 'failed'
    return 'running'
  }
  if (!steps.value.length) return 'draft'
  return 'edit'
})

const statusMap = computed(() => buildStatusMap(steps.value, activeRun.value, activeRunSteps.value))

const testTimeline = computed(() => runLogTimeline(activeRunSteps.value, activeRun.value?.status))

const statusOf = (step: WorkflowStep | undefined): StepStatus | undefined =>
  step ? statusMap.value.get(step.id ?? '')?.status : undefined

const startedSteps = computed(() => Math.max(1, steps.value.filter((s) => {
  const status = statusOf(s)
  return status === 'done' || status === 'running' || status === 'error'
}).length))

// A runner crash can leave the dying step's row on 'running', so that counts
// as the stopper too. Null when the run failed before its first step row.
const failedStep = computed(() => {
  if (mode.value !== 'failed') return null
  const i = steps.value.findIndex((s) => {
    const status = statusOf(s)
    return status === 'error' || status === 'running'
  })
  if (i === -1) return null
  return { n: i + 1, label: workflowStepMeta(steps.value[i]!).label, skipped: steps.value.length - i - 1 }
})

function backToEditing() {
  const failed = failedStep.value ? steps.value[failedStep.value.n - 1] : undefined
  detach()
  if (failed) revealStep(failed)
}

provide(RAIL_CTX, {
  editable,
  openSteps,
  toggleStep,
  root: steps,
  statuses: statusMap,
  submitted,
})

const pr = computed(() => {
  const m = activeRun.value?.log.match(/Opened PR #(\d+): (\S+)/)
  return m ? { number: m[1], url: m[2] } : null
})
</script>

<template>
  <div>
    <div class="mb-3.5 flex items-center gap-2 text-dimmed">
      <NuxtLink
        to="/workflows"
        class="k-mono text-xs transition-colors hover:text-muted"
      >
        Workflows
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <span class="k-mono truncate text-xs text-muted">{{ meta.name || saved?.name || '…' }}</span>
    </div>

    <div
      v-if="notFound"
      class="k-card flex flex-col items-center gap-3 px-6 py-14 text-center"
    >
      <UIcon
        name="i-lucide-workflow"
        class="size-7 text-dimmed"
      />
      <p class="text-2sm text-muted">
        Workflow not found.
        <NuxtLink
          to="/workflows"
          class="text-primary hover:underline"
        >Back to workflows</NuxtLink>
      </p>
    </div>

    <template v-else>
      <KPageHeader
        class="mb-4.5"
        icon="i-lucide-workflow"
        icon-color="var(--text-primary)"
      >
        <input
          v-if="editable"
          v-model="meta.name"
          placeholder="Workflow name"
          spellcheck="false"
          aria-label="Workflow name"
          class="k-mono w-full bg-transparent text-2xl font-semibold tracking-tight text-highlighted outline-none placeholder:text-dimmed"
        >
        <h1
          v-else
          class="k-mono min-w-0 truncate text-2xl font-semibold tracking-tight text-highlighted"
        >
          {{ meta.name }}
        </h1>
        <template #meta>
          <input
            v-if="editable"
            v-model="meta.description"
            placeholder="Short description (optional)"
            class="w-full bg-transparent text-2sm text-muted outline-none placeholder:text-dimmed"
          >
          <span
            v-else-if="meta.description"
            class="truncate text-2sm text-muted"
          >{{ meta.description }}</span>
        </template>
        <template #actions>
          <template v-if="mode === 'running'">
            <UButton
              color="error"
              variant="outline"
              label="Cancel run"
              :loading="cancelling"
              @click="cancel"
            />
            <UButton
              color="neutral"
              variant="ghost"
              label="Run in background"
              @click="detach"
            />
          </template>
          <template v-else-if="mode === 'success'">
            <UButton
              v-if="pr"
              color="neutral"
              variant="outline"
              icon="i-lucide-external-link"
              label="View PR"
              :to="pr.url"
              target="_blank"
            />
            <UButton
              color="primary"
              label="Close"
              @click="detach"
            />
          </template>
          <template v-else-if="mode === 'failed'">
            <UButton
              color="neutral"
              variant="ghost"
              label="View log"
              @click="() => { navigateTo(runWorkspacePath(activeRun!.projectId, activeRun!.id)) }"
            />
            <UTooltip text="Closes the test result and opens the failed step for editing. The failed run stays on the runs page.">
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-pencil"
                label="Fix failed step"
                @click="backToEditing"
              />
            </UTooltip>
            <UTooltip text="Continues this run at the failed step, keeping earlier step results. Runs the definition this test started with, without edits made since.">
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-play"
                label="Resume run"
                :loading="retrying"
                @click="retry"
              />
            </UTooltip>
            <UTooltip text="Starts a fresh test run with the current workflow definition, picking up your edits.">
              <UButton
                color="primary"
                icon="i-lucide-refresh-cw"
                label="Test again"
                @click="retest"
              />
            </UTooltip>
          </template>
          <template v-else>
            <span
              v-if="saveState === 'saving'"
              class="k-mono flex items-center gap-1.5 text-2xs text-dimmed"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-3.5 animate-spin"
              /> Saving…
            </span>
            <UTooltip
              v-else-if="saveState === 'error'"
              :text="saveErrorText"
            >
              <span class="k-mono flex items-center gap-1.5 text-2xs text-error">
                <UIcon
                  name="i-lucide-circle-x"
                  class="size-3.5"
                /> Not saved
              </span>
            </UTooltip>
            <!-- onCloseAutoFocus prevented: refocusing the chip scrolls the header
                 back into view and cancels the jump-to-step scroll. -->
            <UPopover
              v-if="draftIssues.length && steps.length"
              v-model:open="issuesOpen"
              :content="{ align: 'end', onCloseAutoFocus: (e: Event) => e.preventDefault() }"
            >
              <button
                type="button"
                class="k-mono flex cursor-pointer items-center gap-1.5 text-2xs"
                :class="flaggedIssues.length ? 'text-accent-orange' : 'text-dimmed'"
              >
                <UIcon
                  :name="flaggedIssues.length ? 'i-lucide-circle-alert' : 'i-lucide-circle-dashed'"
                  class="size-3.5"
                /> {{ flaggedIssues.length ? `${flaggedIssues.length} ${flaggedIssues.length === 1 ? 'Issue' : 'Issues'}` : 'Incomplete' }}
              </button>
              <template #content>
                <div class="w-80 p-1.5">
                  <p class="px-2 pb-1 pt-1.5 text-2xs text-dimmed">
                    {{ flaggedIssues.length ? 'Fix these to run:' : 'Left to fill in before this runs:' }}
                  </p>
                  <button
                    v-for="(issue, i) in draftIssues"
                    :key="i"
                    type="button"
                    class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs text-toned transition-colors enabled:cursor-pointer enabled:hover:bg-(--surface-accented)"
                    :disabled="!issue.target"
                    @click="jumpToIssue(issue)"
                  >
                    <UIcon
                      :name="issue.pristine && !submitted ? 'i-lucide-circle-dashed' : 'i-lucide-circle-alert'"
                      class="mt-0.5 size-3.5 flex-none"
                      :class="issue.pristine && !submitted ? 'text-dimmed' : 'text-accent-orange'"
                    />
                    <span class="min-w-0">{{ issue.text }}</span>
                  </button>
                </div>
              </template>
            </UPopover>
            <UPopover
              v-model:open="runPickerOpen"
              :content="{ side: 'bottom', align: 'end' }"
            >
              <UTooltip
                :text="!steps.length ? 'Add a step first' : !projects?.length ? 'Connect a project first' : ''"
                :disabled="!!steps.length && !!projects?.length"
              >
                <UButton
                  color="primary"
                  icon="i-lucide-play"
                  trailing-icon="i-lucide-chevron-down"
                  label="Run"
                  :disabled="!steps.length || starting || !projects?.length"
                />
              </UTooltip>
              <template #content>
                <div class="w-72 p-3">
                  <div class="k-label mb-1.5">
                    Project
                  </div>
                  <USelectMenu
                    v-model="project"
                    :items="projects ?? []"
                    placeholder="Select a project…"
                    icon="i-lucide-folder-git-2"
                    class="w-full"
                  />

                  <template v-if="project">
                    <div class="k-label mb-1.5 mt-3.5">
                      Branch
                    </div>
                    <USelectMenu
                      v-model="testBranch"
                      :items="testBranchItems"
                      icon="i-lucide-git-branch"
                      :search-input="{ placeholder: 'Filter branches…' }"
                      class="w-full"
                    />

                    <button
                      type="button"
                      :aria-expanded="mockOpen"
                      class="group mt-3.5 flex w-full cursor-pointer items-center gap-1.5"
                      @click="mockOpen = !mockOpen"
                    >
                      <UIcon
                        name="i-lucide-chevron-right"
                        class="size-3.5 text-dimmed transition-transform"
                        :class="mockOpen && 'rotate-90'"
                      />
                      <span class="k-label">Trigger event (mock)</span>
                    </button>
                    <div
                      v-if="mockOpen"
                      class="mt-2 space-y-2"
                    >
                      <template
                        v-for="v in TRIGGER_VARS"
                        :key="v.path"
                      >
                        <UTextarea
                          v-if="v.path === 'inputs.body'"
                          v-model="mockInputs[varPathParts(v.path)[1]]"
                          :placeholder="v.path"
                          :rows="2"
                          class="w-full"
                          :ui="{ base: 'k-mono text-xs' }"
                        />
                        <UInput
                          v-else
                          v-model="mockInputs[varPathParts(v.path)[1]]"
                          :placeholder="v.path"
                          class="w-full"
                          :ui="{ base: 'k-mono text-xs' }"
                        />
                      </template>
                      <p class="text-2xs leading-normal text-dimmed">
                        Empty fields render as empty strings, exactly like a
                        trigger that didn't send them.
                      </p>
                    </div>
                  </template>

                  <UButton
                    class="mt-3.5 w-full justify-center"
                    color="primary"
                    icon="i-lucide-play"
                    label="Run workflow"
                    :loading="starting"
                    :disabled="!project"
                    @click="start"
                  />
                </div>
              </template>
            </UPopover>
            <UDropdownMenu
              v-if="saved"
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
        </template>
      </KPageHeader>

      <div
        v-if="mode === 'running'"
        class="mb-4.5 overflow-hidden rounded-lg border"
        style="border-color: color-mix(in oklab, var(--accent-orange) 40%, transparent); background: color-mix(in oklab, var(--accent-orange) 10%, transparent)"
      >
        <div class="flex items-center gap-3 px-4 py-3.5">
          <UIcon
            name="i-lucide-play"
            class="size-4.5 flex-none text-accent-orange"
          />
          <div class="text-2sm leading-snug text-toned">
            Test run in the real project · <b>Step {{ startedSteps }} of {{ steps.length }}</b> · executing…
          </div>
        </div>
        <div class="h-1 bg-(--surface-accented)">
          <div
            class="h-full bg-accent-orange"
            :style="{ width: `${(startedSteps / steps.length) * 100}%`, boxShadow: '0 0 12px var(--accent-orange)' }"
          />
        </div>
      </div>
      <div
        v-else-if="mode === 'success'"
        class="mb-4.5 flex items-center gap-3 rounded-lg border px-4 py-3.5"
        style="border-color: var(--primary-border); background: color-mix(in oklab, var(--primary) 10%, transparent)"
      >
        <UIcon
          name="i-lucide-check"
          class="size-4.5 flex-none text-primary"
        />
        <div class="text-2sm leading-snug text-toned">
          <b>Test succeeded.</b> All {{ steps.length }} steps green<template v-if="pr">
            · Pull Request #{{ pr.number }} created
          </template> · runtime {{ runDuration(activeRun!.startedAt, activeRun!.finishedAt) }}
        </div>
      </div>
      <div
        v-else-if="mode === 'failed'"
        class="mb-4.5 flex items-center gap-3 rounded-lg border px-4 py-3.5"
        style="border-color: color-mix(in oklab, var(--status-error) 45%, transparent); background: color-mix(in oklab, var(--status-error) 12%, transparent)"
      >
        <UIcon
          name="i-lucide-flask-conical"
          class="size-4.5 flex-none text-error"
        />
        <div class="text-2sm leading-snug text-toned">
          <template v-if="failedStep">
            <b>Test failed at step {{ failedStep.n }}, "{{ failedStep.label }}".</b>
            <template v-if="failedStep.skipped">
              The {{ failedStep.skipped === 1 ? 'following step was' : `following ${failedStep.skipped} steps were` }} skipped.
            </template>
          </template>
          <template v-else>
            <b>Test failed before its first step.</b> The log below has the details.
          </template>
        </div>
      </div>

      <!-- Sidebar sizing matches projects/[id].vue, keep them in sync. -->
      <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_clamp(340px,26vw,560px)]">
        <div
          class="min-w-0"
          @dragover="overList(steps, 1, $event)"
          @drop.prevent="performDrop()"
        >
          <div class="mb-3 flex gap-3.5">
            <div class="flex w-7.5 flex-none flex-col items-center">
              <span
                class="grid size-7.5 flex-none place-items-center rounded-full"
                style="background: color-mix(in oklab, var(--accent-violet) 16%, var(--surface-muted)); border: 1px solid color-mix(in oklab, var(--accent-violet) 55%, transparent)"
              >
                <UIcon
                  name="i-lucide-zap"
                  class="size-4 text-accent-violet"
                />
              </span>
              <span
                class="my-1 w-0.5 flex-1 rounded-sm bg-(--border-default)"
                style="min-height: 16px"
              />
            </div>

            <div
              v-if="workflowTriggers.length"
              class="min-w-0 flex-1 overflow-hidden rounded-lg border border-default bg-(--surface-muted) shadow-panel"
            >
              <div
                v-if="saved && !saved.enabled"
                class="flex items-center justify-between gap-3 border-b border-muted px-4 py-2 text-2xs"
                style="background: color-mix(in oklab, var(--accent-orange) 9%, transparent)"
              >
                <span class="k-mono text-accent-orange">Paused: triggers won’t fire</span>
                <UTooltip
                  :text="valid ? 'Enable triggers' : 'Finish the step config first'"
                >
                  <KToggle
                    :active="false"
                    :disabled="togglingEnabled"
                    aria-label="Enable triggers"
                    @toggle="toggleEnabled"
                  />
                </UTooltip>
              </div>

              <div
                v-for="t in workflowTriggers"
                :key="t.id"
                class="flex items-start gap-3 border-b border-muted px-4 py-3.5 transition-opacity"
                :style="{ opacity: (t.active && saved?.enabled) ? 1 : 0.45 }"
              >
                <button
                  type="button"
                  class="group flex min-w-0 flex-1 items-start gap-3 text-left enabled:cursor-pointer"
                  aria-label="Edit trigger"
                  :disabled="!editable"
                  @click="editTrigger(t)"
                >
                  <KStepIcon
                    :icon="triggerSourceMeta(t.source).icon"
                    :color="triggerSourceMeta(t.source).color"
                    :size="32"
                    :radius="8"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span class="text-sm font-medium text-highlighted">
                        {{ triggerSourceMeta(t.source).label }} {{ t.kind }}
                      </span>
                    </span>
                    <span
                      v-if="t.source === 'schedule'"
                      class="mt-1 block text-xs text-muted"
                    >{{ t.event }}</span>
                    <span
                      v-else
                      class="mt-1 flex flex-col gap-1 text-xs text-muted"
                    >
                      <span class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span>on</span>
                        <template
                          v-for="(segments, ei) in t.events"
                          :key="ei"
                        >
                          <span
                            v-if="ei > 0"
                            class="-ml-1.5"
                          >,</span>
                          <KTriggerSegments :segments="segments" />
                        </template>
                      </span>
                      <span
                        v-for="(group, gi) in t.conditions"
                        :key="gi"
                        class="flex flex-wrap items-center gap-x-1.5 gap-y-1"
                      >
                        <span>{{ gi === 0 ? 'if' : 'or' }}</span>
                        <template
                          v-for="(segments, ci) in group"
                          :key="ci"
                        >
                          <span v-if="ci > 0">and</span>
                          <KTriggerSegments :segments="segments" />
                        </template>
                      </span>
                    </span>
                  </span>
                </button>
                <div class="flex w-37.5 flex-none flex-wrap justify-end gap-1.5 pt-1.5">
                  <span
                    v-for="name in projectChips(t.projects)"
                    :key="name"
                    class="k-code whitespace-nowrap text-2xs"
                  >{{ name }}</span>
                  <span
                    v-if="!t.projects.length"
                    class="k-code whitespace-nowrap text-2xs text-(--status-orange)"
                  >no projects</span>
                </div>
                <div class="flex h-8 items-center gap-1">
                  <KToggle
                    :active="t.active"
                    :disabled="!editable"
                    :aria-label="t.active ? 'Pause trigger' : 'Activate trigger'"
                    @toggle="toggleTrigger(t)"
                  />
                  <UDropdownMenu
                    :items="[{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => removeTrigger(t) }]"
                    :content="{ align: 'end' }"
                  >
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-ellipsis-vertical"
                      aria-label="Trigger actions"
                      :disabled="!editable"
                    />
                  </UDropdownMenu>
                </div>
              </div>
            </div>
            <UButton
              v-else-if="editable"
              color="neutral"
              variant="outline"
              icon="i-lucide-plus"
              label="Add trigger"
              class="w-full justify-center self-start"
              @click="triggerModalOpen = true"
            />
          </div>

          <div
            v-if="editable && workflowTriggers.length"
            class="mb-3 flex gap-3.5"
          >
            <div class="w-7.5 flex-none" />
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-plus"
              label="Add trigger"
              class="w-full justify-center"
              @click="triggerModalOpen = true"
            />
          </div>

          <div
            v-if="!steps.length"
            class="flex gap-3.5"
          >
            <div class="flex w-7.5 flex-none justify-center">
              <span class="grid size-7.5 place-items-center rounded-full border border-dashed border-accented text-dimmed">
                <UIcon
                  name="i-lucide-plus"
                  class="size-4"
                />
              </span>
            </div>
            <div
              class="flex flex-1 flex-col items-center gap-4 rounded-lg border border-dashed bg-(--surface-glass) px-6 py-9 text-center"
              :style="{ borderColor: drag?.kind === 'lib' ? 'var(--primary)' : 'var(--border-accented)' }"
            >
              <img
                src="/mascot/mascotRight.png"
                alt="Knecht"
                class="h-auto w-19 drop-shadow-mascot"
              >
              <div>
                <div class="text-base font-medium text-toned">
                  No steps yet
                </div>
                <div class="mx-auto mt-1.5 max-w-80 text-2sm text-muted">
                  Add steps from the library on the right to build out the sequence.
                </div>
              </div>
              <UButton
                color="primary"
                icon="i-lucide-plus"
                label="Add first step"
                @click="addStep('ddev-start')"
              />
            </div>
          </div>

          <WorkflowStepList
            v-else
            :steps="steps"
            :depth="1"
            :vars-base="baseVarGroups()"
          />

          <div
            v-if="editable && steps.length"
            class="flex flex-col"
            @dragover="overAt(steps, 1, steps.length, $event)"
          >
            <div class="flex gap-3.5">
              <div class="w-7.5 flex-none" />
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-plus"
                label="Add action"
                class="w-full justify-center"
                @click="addStep('bash')"
              />
            </div>
          </div>

          <div
            v-if="activeRun"
            class="ml-11 mt-1"
          >
            <KPanel
              v-if="mode === 'running'"
              title="Live log"
              icon="i-lucide-terminal"
              accent="var(--accent-orange)"
              :pad="0"
            >
              <template #action>
                <span class="k-mono text-3xs text-dimmed">run #{{ activeRun.id }}</span>
              </template>
              <KRunLog
                :log="activeRun.log"
                :rows="testTimeline"
                live
                :run-status="activeRun.status"
                :run-started-at="activeRun.startedAt"
                :run-finished-at="activeRun.finishedAt"
              />
            </KPanel>

            <KPanel
              v-else-if="mode === 'success'"
              title="Run result"
              icon="i-lucide-check"
              accent="var(--primary)"
              :pad="0"
            >
              <div class="flex flex-col gap-3.5 p-5">
                <a
                  v-if="pr"
                  :href="pr.url"
                  target="_blank"
                  class="flex items-center gap-3 rounded-md border p-3"
                  style="border-color: var(--primary-border); background: color-mix(in oklab, var(--primary) 7%, transparent)"
                >
                  <KStepIcon
                    icon="i-lucide-git-pull-request"
                    color="var(--primary)"
                    :size="30"
                    :radius="7"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="text-2sm text-default">
                      Pull Request #{{ pr.number }}
                    </div>
                    <span class="k-mono text-2xs text-dimmed">view on GitHub</span>
                  </div>
                  <UIcon
                    name="i-lucide-external-link"
                    class="size-4 text-dimmed"
                  />
                </a>
                <div class="flex items-center gap-6">
                  <span class="k-mono text-2xs text-dimmed">Steps <span class="text-primary">{{ steps.length }} / {{ steps.length }}</span></span>
                  <span class="k-mono text-2xs text-dimmed">Runtime <span class="text-toned">{{ runDuration(activeRun.startedAt, activeRun.finishedAt) }}</span></span>
                </div>
              </div>
              <div class="border-t border-muted">
                <KRunLog
                  :log="activeRun.log"
                  :rows="testTimeline"
                  :live="false"
                  :run-status="activeRun.status"
                  :run-started-at="activeRun.startedAt"
                  :run-finished-at="activeRun.finishedAt"
                />
              </div>
            </KPanel>

            <KPanel
              v-else
              title="Error details"
              icon="i-lucide-flask-conical"
              accent="var(--status-error)"
              :pad="0"
            >
              <div class="flex items-center justify-between p-5">
                <span class="k-mono text-2xs text-dimmed">Failed at step</span>
                <span class="k-mono text-2xs text-error">{{ failedStep ? `${failedStep.n} of ${steps.length}` : 'before step 1' }}</span>
              </div>
              <div class="border-t border-muted">
                <KRunLog
                  :log="activeRun.log"
                  :rows="testTimeline"
                  :live="false"
                  :run-status="activeRun.status"
                  :run-started-at="activeRun.startedAt"
                  :run-finished-at="activeRun.finishedAt"
                />
              </div>
            </KPanel>
          </div>
        </div>

        <div class="lg:sticky lg:top-4">
          <WorkflowStepLibrary
            :editable="editable"
            @add="addStep"
            @drag="startLibDrag"
            @dragend="endDrag"
          />
        </div>
      </div>
    </template>

    <KTriggerCreateModal
      v-model:open="triggerModalOpen"
      :preset-workflow-id="saved?.id"
      :trigger="editingTrigger"
      @created="refreshTriggers"
    />

    <KConfirmModal
      v-model:open="confirmDelete"
      title="Delete workflow"
      :description="`Deletes ${meta.name || saved?.name} along with its configured triggers.`"
      confirm-label="Delete"
      :loading="removing"
      @confirm="removeWorkflow"
    />
  </div>
</template>
