<script setup lang="ts">
import { runWorkspacePath } from '#shared/utils/routes'
import { flattenSteps } from '#shared/utils/workflow'
import type { TestRunRow } from '~/composables/useWorkflowTestRun'

// The workflow edit surface. A numbered step rail on the left (editable: add
// from the library, reorder, remove, edit each step's params) and a context
// panel on the right. Edits autosave continuously: name/description straight
// onto the row, the steps as a loosely validated DRAFT. Manual runs (the
// inline test here, the project page) always execute the draft, validated at
// start. Only AUTOMATION runs a published snapshot: the automation switch
// publishes the current state when turned on, and "Apply changes" updates the
// snapshot while it is on. Per-step progress overlays derive from the run
// log's `▶ <step>` markers: no extra backend tracking.

const route = useRoute()
const toast = useToast()
const toastError = useToastError()

// The id is the workflow's identity (the name is a display field).
const id = computed(() => Number(route.params.id))

const { data: workflows, refresh } = await useFetch('/api/workflows', { default: () => [] })
// The run picker's projects and the trigger panel load lazily: neither blocks
// rendering the editor itself.
const { data: projects } = useFetch('/api/projects', {
  default: () => [],
  lazy: true,
  transform: rows => rows.map(p => ({ ...p, label: p.fullName })),
})
const { data: allTriggers, refresh: refreshTriggers } = useFetch('/api/triggers', { default: () => [], lazy: true })

// The persisted record (null for an unknown id).
const saved = computed(() => workflows.value?.find(w => w.id === id.value) ?? null)
const notFound = computed(() => !saved.value)

// ── the editor's working copy ────────────────────────────────────────────────
// Two independent autosaves (the settings-page pattern): `meta` (name +
// description) PATCHes the row directly since neither affects execution;
// `steps` PATCHes the loose draft. Publish promotes the persisted draft.
const meta = reactive({ name: '', description: '' })
const metaOriginal = ref('')
const steps = ref<WorkflowStep[]>([])
const stepsOriginal = ref('')
// A failed publish drops the pristine grace everywhere and flags every issue.
const submitted = ref(false)
// Which steps have their settings expanded: several can be open at once.
// Tracked by step OBJECT (not index), so the open state survives reordering.
const openSteps = ref(new Set<WorkflowStep>())

function toggleStep(step: WorkflowStep) {
  if (openSteps.value.has(step)) openSteps.value.delete(step)
  else openSteps.value.add(step)
}

// Open a step's settings and bring its card into view.
function revealStep(step: WorkflowStep) {
  openSteps.value.add(step)
  nextTick(() => document.getElementById(`step-card-${step.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
}

// Any step in the tree carrying `id`: nested steps are always visible in the
// rail now, so a deep link opens the exact card.
function stepWithId(stepId: string): WorkflowStep | undefined {
  return flattenSteps(steps.value).find(s => s.id === stepId)
}

// Deep link from a run's failure card: ?step=<id> lands with that step open.
onMounted(() => {
  const stepId = route.query.step
  if (typeof stepId !== 'string') return
  const step = stepWithId(stepId)
  if (step) revealStep(step)
})

// Initialize ONCE per workflow (and again on discard): from then on the
// editor owns the working copy, a list refresh never resets it. The steps
// start from the persisted draft, falling back to the published version.
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

// ── autosave (meta + draft) ──────────────────────────────────────────────────
// The shared name rule (shared/utils/workflow.ts): the same regex the
// server's patch schema validates with.
const nameValid = computed(() => WORKFLOW_NAME_RE.test(meta.name.trim()))

const metaSave = useAutosave(async () => {
  await $fetch(`/api/workflows/${id.value}`, {
    method: 'PATCH',
    body: { name: meta.name.trim(), description: meta.description },
  })
  metaOriginal.value = JSON.stringify({ ...meta })
  // Safe: the steps working copy lives separately, nothing to clobber.
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
  // No refresh: the editor owns the draft.
  stepsOriginal.value = json
})
watch(stepsJson, (json) => {
  if (!saved.value || json === stepsOriginal.value) return
  draftSave.schedule()
})

// One indicator for both autosaves: an error wins, then an in-flight save.
const saveState = computed(() => {
  if (metaSave.state.value === 'error' || draftSave.state.value === 'error') return 'error' as const
  if (metaSave.state.value === 'saving' || draftSave.state.value === 'saving') return 'saving' as const
  if (metaSave.state.value === 'saved' || draftSave.state.value === 'saved') return 'saved' as const
  return 'idle' as const
})
const saveErrorText = computed(() =>
  metaSave.state.value === 'error' ? metaSave.error.value : draftSave.error.value)

// ── live version ─────────────────────────────────────────────────────────────
// Every complete save auto-promotes to the live version (`steps`); only an
// incomplete save stays behind as `draftSteps`, and triggers keep running the
// last complete version meanwhile. So "the server holds a draft" simply means
// "the current edits are not runnable yet".
const hasIncompleteEdits = computed(() => !!saved.value?.draftSteps)

// ── inline test run (composable owns picker, run state and polling) ────────
// Tests execute the DRAFT: the pending autosave is flushed first so the
// server pins exactly what the rail shows.
const { open, project, starting, activeRun, activeRunSteps, testBranch, testBranchItems, mockInputs, start, detach, retest, cancel, cancelling, retry, retrying }
  = useWorkflowTestRun<(typeof projects.value)[number]>(() => saved.value?.id, {
    beforeStart: () => draftSave.flush(),
    onStarted: () => openSteps.value.clear(),
  })

// The "Trigger event (mock)" section of the run popover, collapsed by default.
const mockOpen = ref(false)

// The run popover's open state, doubling as the validation trigger: clicking
// Run on an invalid draft flags every issue and opens the issue list instead
// of the picker (the same move the automation switch makes). The button stays
// clickable so the click can explain itself.
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

// ── triggers wired to this workflow (the head of the flow) ──────────────────
// Manual is always implicit; configured triggers (schedule/webhook/saved
// manual) stack above it and are managed right here.
const workflowTriggers = computed(() =>
  saved.value ? (allTriggers.value ?? []).filter(t => t.workflowId === saved.value!.id) : [])
const triggerModalOpen = ref(false)
// Clicking a trigger row edits it; "Add trigger" opens a blank form.
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

// The automation master switch, THE lightswitch: on = triggers fire (with
// the latest complete version), off = paused. Manual runs / tests are
// unaffected either way. Turning it on flushes the pending autosave first so
// "the current state" is what just went live.
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

// ── header overflow menu: export (a browser download; the endpoint sets
// content-disposition), discard draft, and the destructive delete behind a
// confirm. Export serves the current state, so it needs a complete one. ─────
const confirmDelete = ref(false)
const menuItems = computed(() => [
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

// ── step mutations (step identity/fields come from the registry) ────────────
function addStep(type: WorkflowStep['type']) {
  const step = makeStep(type, steps.value)
  steps.value.push(step)
  openSteps.value.add(steps.value.at(-1)!)
}

// ── drag & drop: one insertion-line model for reorder, moves and library ────
// Row-level tracking lives in StepCard/StepList (via WORKFLOW_DND); the page
// wires the library, the rail container and the single drop handler.
const { drag, startLibDrag, overList, overAt, performDrop, endDrag }
  = useWorkflowDnd(steps, openSteps, editable)

// ── validation (gates publishing and running, never saving) ─────────────────
// Everything blocking a publish, one row per problem: the header's popover
// lists these; clicking a row opens the affected step. `target` is the
// TOP-LEVEL step to reveal (sub-step problems name the offender in the text
// but expand their composite's card). `pristine` rows sit on a step the user
// hasn't started filling in: still blocking, but rendered as neutral to-dos.
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
// Problems the editor highlights: those on steps the user has actually
// started configuring, or ALL of them once a publish attempt failed.
const flaggedIssues = computed(() => draftIssues.value.filter(i => submitted.value || !i.pristine))
// Children (field highlights, sub-step borders) follow the same switch.
provide(FORCE_STEP_ISSUES, submitted)

// Once every problem is fixed, drop back into the quiet (pristine-aware)
// mode: freshly added steps stay calm again until the next publish attempt.
watch(valid, (ok) => {
  if (ok) submitted.value = false
})

// The header popover's open state, closed when a row jumps to its step.
const issuesOpen = ref(false)
function jumpToIssue(issue: DraftIssue) {
  issuesOpen.value = false
  if (issue.target) revealStep(issue.target)
}

// ── discard ──────────────────────────────────────────────────────────────────
// Drop incomplete edits and snap the rail back to the last complete version.
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

// Cmd/Ctrl+S has nothing left to save (autosave does), but muscle memory
// deserves better than the browser's save dialog: flush the pending edits.
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void draftSave.flush()
    void metaSave.flush()
  }
}
// Closing the tab mid-save (or mid-debounce) could lose the last edit; the
// route-leave case needs nothing, useAutosave flushes on unmount.
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

// ── page mode ───────────────────────────────────────────────────────────
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

// ── per-step status (vocabulary + treatments live in utils/step-status) ────

// Run status for EVERY step in the tree, keyed by step id (nested rows carry
// parentStepId/iteration; buildStatusMap infers skipped/pending for row-less
// steps). Empty map without a run: cards fall back to idle/selected.
const statusMap = computed(() => buildStatusMap(steps.value, activeRun.value, activeRunSteps.value))

// The test run's log timeline (same presentation as the run workspace's log).
const testTimeline = computed(() => runLogTimeline(activeRunSteps.value))

const statusOf = (step: WorkflowStep | undefined): StepStatus | undefined =>
  step ? statusMap.value.get(step.id ?? '')?.status : undefined

// 1-based "step N of M" for the live banner (top-level steps started so far).
const startedSteps = computed(() => Math.max(1, steps.value.filter((s) => {
  const status = statusOf(s)
  return status === 'done' || status === 'running' || status === 'error'
}).length))

// The failed test's banner facts: the step that stopped the run (1-based
// position + label) and how many later steps never ran. A runner crash can
// leave the dying step's row on 'running', so that counts as the stopper too.
// Null when the run failed before its first step row; the log has the story.
const failedStep = computed(() => {
  if (mode.value !== 'failed') return null
  const i = steps.value.findIndex((s) => {
    const status = statusOf(s)
    return status === 'error' || status === 'running'
  })
  if (i === -1) return null
  return { n: i + 1, label: workflowStepMeta(steps.value[i]!).label, skipped: steps.value.length - i - 1 }
})

// Leaving a failed test jumps straight into fixing it: the failed step's
// settings open and its card scrolls into view.
function backToEditing() {
  const failed = failedStep.value ? steps.value[failedStep.value.n - 1] : undefined
  detach()
  if (failed) revealStep(failed)
}

// The recursive rail (WorkflowStepList/StepCard) reads the page-global state
// through this context.
provide(RAIL_CTX, {
  editable,
  openSteps,
  toggleStep,
  root: steps,
  statuses: statusMap,
  submitted,
})

// ── run-derived summary values (real, parsed from the log + timestamps) ────
const pr = computed(() => {
  const m = activeRun.value?.log.match(/Opened PR #(\d+): (\S+)/)
  return m ? { number: m[1], url: m[2] } : null
})

function fmtDuration(a: TestRunRow['startedAt'], b: TestRunRow['finishedAt']): string {
  if (!a || !b) return '-'
  const ms = new Date(b).getTime() - new Date(a).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '-'
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
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
      <!-- Header -->
      <KPageHeader
        class="mb-4.5"
        icon="i-lucide-workflow"
        icon-color="var(--text-primary)"
      >
        <!-- The title is the name field: always editable, autosaved. -->
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
            <!-- The quiet header: autosave surfaces only while saving or on
                 error, everything else lives where it acts (the automation
                 panel owns the snapshot state). -->
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
            <!-- onCloseAutoFocus prevented: closing would refocus the chip,
                 which scrolls the header back into view and cancels the
                 jump-to-step scroll a row click just started. -->
            <!-- Hidden while the rail is empty: the empty state already says
                 what to do, a chip would just nag. -->
            <UPopover
              v-if="draftIssues.length && steps.length"
              v-model:open="issuesOpen"
              :content="{ align: 'end', onCloseAutoFocus: (e: Event) => e.preventDefault() }"
            >
              <!-- Orange only once a touched step is broken; while everything
                   missing is just not-yet-configured, the chip stays neutral. -->
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

      <!-- Banner -->
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
          </template> · runtime {{ fmtDuration(activeRun!.startedAt, activeRun!.finishedAt) }}
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

      <!-- Two columns: step rail (settings expand inline in the cards) +
           library. Sidebar sizing matches projects/[id].vue exactly
           (viewport-based clamp, can't drift between screens). -->
      <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_clamp(340px,26vw,560px)]">
        <div
          class="min-w-0"
          @dragover="overList(steps, 1, $event)"
          @drop.prevent="performDrop()"
        >
          <!-- Triggers: the head of the flow, ONE grouped panel (master switch,
               configured triggers, the always-available manual start), joined to
               the steps below by the rail spine so it reads as a single flow. -->
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
              class="min-w-0 flex-1 overflow-hidden rounded-lg border border-default bg-(--surface-muted) shadow-panel"
            >
              <!-- Header + master switch, THE lightswitch: on = triggers fire
                   with the latest complete version, off = paused (manual runs
                   / tests are unaffected). While the current edits are
                   incomplete, triggers keep running the last complete version;
                   the subline says so. Only shown once a trigger is
                   configured: with just the implicit manual start there is
                   nothing the switch could control. -->
              <div
                v-if="saved && workflowTriggers.length"
                class="flex items-center justify-between gap-3 border-b border-muted px-4 py-2.5 transition-colors"
                :style="saved.enabled ? {} : { background: 'color-mix(in oklab, var(--accent-orange) 9%, transparent)' }"
              >
                <div class="flex min-w-0 items-center gap-2.5">
                  <UIcon
                    :name="saved.enabled ? 'i-lucide-zap' : 'i-lucide-pause'"
                    class="size-4 flex-none transition-colors"
                    :class="saved.enabled ? 'text-dimmed' : 'text-accent-orange'"
                  />
                  <div class="min-w-0">
                    <div class="text-2sm font-medium text-highlighted">
                      Automation
                    </div>
                    <div
                      class="k-mono truncate text-2xs transition-colors"
                      :class="saved.enabled ? 'text-dimmed' : 'text-accent-orange'"
                    >
                      {{ saved.enabled
                        ? (hasIncompleteEdits ? 'Triggers run the last complete version' : 'Triggers fire automatically')
                        : 'Paused: triggers won’t fire' }}
                    </div>
                  </div>
                </div>
                <UTooltip :text="saved.enabled ? 'Pause automation' : (valid ? 'Enable automation' : 'Finish the step config first')">
                  <KToggle
                    :active="saved.enabled"
                    :disabled="togglingEnabled"
                    :aria-label="saved.enabled ? 'Pause automation' : 'Enable automation'"
                    @toggle="toggleEnabled"
                  />
                </UTooltip>
              </div>

              <!-- Configured triggers (divided rows within the group). Dimmed
                   when the row is paused individually OR the master switch is
                   off, so a paused automation is visibly inert. -->
              <div
                v-for="t in workflowTriggers"
                :key="t.id"
                class="group/row flex items-center gap-3 border-b border-muted px-3 py-2.5 transition-opacity"
                :style="{ opacity: (t.active && saved?.enabled) ? 1 : 0.45 }"
              >
                <button
                  type="button"
                  class="group flex min-w-0 flex-1 items-center gap-3 text-left"
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
                    <span class="block text-2sm text-highlighted">
                      {{ triggerSourceMeta(t.source).label }}
                    </span>
                    <span class="k-mono block truncate text-2xs text-dimmed transition-colors group-hover:text-muted">
                      {{ t.event }} · {{ t.projects.length ? t.projects.join(', ') : 'no projects' }}
                    </span>
                  </span>
                </button>
                <KToggle
                  :active="t.active"
                  :disabled="!editable"
                  :aria-label="t.active ? 'Pause trigger' : 'Activate trigger'"
                  @toggle="toggleTrigger(t)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-trash-2"
                  aria-label="Delete trigger"
                  :disabled="!editable"
                  class="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
                  @click="removeTrigger(t)"
                />
              </div>

              <!-- Manual: always available, run it now against a chosen
                   project + branch (right here, not from a separate button). -->
              <div class="flex items-center gap-3 px-3 py-2.5">
                <KStepIcon
                  icon="i-lucide-play"
                  color="var(--accent-violet)"
                  :size="32"
                  :radius="8"
                />
                <div class="min-w-0 flex-1">
                  <div class="text-2sm text-highlighted">
                    Manual
                  </div>
                  <div class="k-mono truncate text-2xs text-dimmed">
                    always available · run on demand
                  </div>
                </div>
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
                      size="xs"
                      icon="i-lucide-play"
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

                        <!-- Mock trigger event: fills {{ inputs.* }} so workflows
                             built for triggers are testable without one. -->
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
              </div>

              <!-- Add another trigger (group footer). Configure them anytime;
                   they fire once the automation switch is on. -->
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-2 border-t border-muted px-3 py-2.5 text-left text-xs text-muted transition-colors hover:bg-(--surface-glass) disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!editable"
                @click="triggerModalOpen = true"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-4 flex-none text-dimmed"
                />
                Add trigger
              </button>
            </div>
          </div>

          <!-- Empty (draft) -->
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

          <!-- Step rail: the recursive flowchart (if branches, loop bodies) -->
          <WorkflowStepList
            v-else
            :steps="steps"
            :depth="1"
            :vars-base="baseVarGroups()"
          />

          <!-- Add-step affordance under the rail (also the append drop zone) -->
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
                label="Add step"
                class="w-full justify-center"
                @click="addStep('bash')"
              />
            </div>
          </div>

          <!-- Run output, below the steps -->
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
                  <span class="k-mono text-2xs text-dimmed">Runtime <span class="text-toned">{{ fmtDuration(activeRun.startedAt, activeRun.finishedAt) }}</span></span>
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

        <!-- Right column: the step library -->
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

    <TriggerCreateModal
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
