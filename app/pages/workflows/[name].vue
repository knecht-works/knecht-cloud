<script setup lang="ts">
import { stepChildren } from '#shared/utils/workflow'
import type { TestRunRow } from '~/composables/useWorkflowTestRun'

// The workflow create/edit surface. A numbered step rail on the left (editable:
// add from the library, reorder, remove, edit each step's params) and a context
// panel on the right. Edits live in a local `draft` and persist via the
// workflows CRUD API. An inline test run overlays per-step progress derived from
// the run log's `▶ <step>` markers: no extra backend tracking.

const route = useRoute()
const toast = useToast()
const toastError = useToastError()

const isNew = computed(() => String(route.params.name) === 'new')
const routeName = computed(() => decodeURIComponent(String(route.params.name)))

const { data: workflows, refresh } = await useFetch('/api/workflows', { default: () => [] })
// The run picker's projects and the trigger panel load lazily: neither blocks
// rendering the editor itself.
const { data: projects } = useFetch('/api/projects', {
  default: () => [],
  lazy: true,
  transform: rows => rows.map(p => ({ ...p, label: p.fullName })),
})
const { data: allTriggers, refresh: refreshTriggers } = useFetch('/api/triggers', { default: () => [], lazy: true })

// The persisted record (null for a new draft or an unknown name).
const saved = computed(() => isNew.value ? null : (workflows.value?.find(w => w.name === routeName.value) ?? null))
const notFound = computed(() => !isNew.value && !saved.value)

// ── editable draft ─────────────────────────────────────────────────────────
interface Draft { name: string, description: string, steps: WorkflowStep[] }
const draft = ref<Draft>({ name: '', description: '', steps: [] })
const original = ref('')
// Save state (see the explicit-save section below); declared with the draft
// because resetDraft clears it.
const saving = ref(false)
const saveError = ref<string>()
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

// The top-level step carrying `id`, or the composite containing it: only
// top-level cards expand, sub-steps render inside their composite's settings.
function stepWithId(id: string): WorkflowStep | undefined {
  const contains = (step: WorkflowStep): boolean =>
    step.id === id || stepChildren(step).flat().some(contains)
  return draft.value.steps.find(s => contains(s))
}

// Deep link from a run's failure card: ?step=<id> lands with that step open.
onMounted(() => {
  const id = route.query.step
  if (typeof id !== 'string') return
  const step = stepWithId(id)
  if (step) revealStep(step)
})

function resetDraft() {
  const base: Draft = saved.value
    ? { name: saved.value.name, description: saved.value.description, steps: structuredClone(toRaw(saved.value.steps)) as WorkflowStep[] }
    : { name: '', description: '', steps: [] }
  draft.value = base
  original.value = JSON.stringify(base)
  openSteps.value.clear()
  submitted.value = false
  saveError.value = undefined
}
resetDraft()
// Re-init only when navigating to a different workflow, NOT when the list
// refreshes after an auto-save (that would clobber the in-progress edit). The
// guard skips the reset right after we navigate following a create/rename.
let skipReset = false
watch(routeName, () => {
  if (skipReset) {
    skipReset = false
    return
  }
  resetDraft()
})

const steps = computed(() => draft.value.steps)

// ── inline test run (composable owns picker, run state and polling) ────────
const { open, project, starting, activeRun, activeRunSteps, testBranch, testBranchItems, mockInputs, start, detach, retest, cancel, cancelling, retry, retrying }
  = useWorkflowTestRun<(typeof projects.value)[number]>(() => saved.value?.name, () => openSteps.value.clear())

// The "Trigger event (mock)" section of the run popover, collapsed by default.
const mockOpen = ref(false)

const editable = computed(() => !activeRun.value)

// ── triggers wired to this workflow (the head of the flow) ──────────────────
// Manual is always implicit; configured triggers (schedule/webhook/saved
// manual) stack above it and are managed right here.
const workflowTriggers = computed(() =>
  saved.value ? (allTriggers.value ?? []).filter(t => t.workflow === saved.value!.name) : [])
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

// The workflow's automation master switch. Sends the PERSISTED body (not the
// in-progress draft) plus the flipped flag, so toggling never clobbers an
// unsaved edit. Manual runs / tests are unaffected by this.
const togglingEnabled = ref(false)
async function toggleEnabled() {
  if (!saved.value) return
  togglingEnabled.value = true
  try {
    await $fetch(`/api/workflows/${encodeURIComponent(saved.value.name)}`, {
      method: 'PATCH',
      body: { name: saved.value.name, description: saved.value.description, steps: saved.value.steps, enabled: !saved.value.enabled },
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
// content-disposition) plus the destructive delete behind a confirm. ────────
const confirmDelete = ref(false)
const menuItems = computed(() => [
  (['yaml', 'json'] as const).map(format => ({
    label: `Export ${format.toUpperCase()}`,
    icon: 'i-lucide-file-down',
    onSelect: () => {
      if (saved.value) window.location.assign(`/api/workflows/${encodeURIComponent(saved.value.name)}/export?format=${format}`)
    },
  })),
  [{
    label: 'Delete workflow',
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => { confirmDelete.value = true },
  }],
])

// ── step mutations (step identity/fields come from the registry) ────────────
function addStep(type: WorkflowStep['type']) {
  const step = makeStep(type, draft.value.steps)
  draft.value.steps.push(step)
  openSteps.value.add(draft.value.steps.at(-1)!)
}
function removeStep(i: number) {
  const [removed] = draft.value.steps.splice(i, 1)
  if (removed) openSteps.value.delete(removed)
}

// ── drag & drop: reorder rows + drop new steps from the library ─────────────
const { dragIndex, dragArmed, libDrag, dropIndex, onDragStart, onDragOver, onRailOver, onRailDrop, endDrag }
  = useStepDnd(steps, openSteps)

// ── explicit save ────────────────────────────────────────────────────────────
// Edits stay local until Save (button or Cmd/Ctrl+S): the click is the one
// fixed point where validation runs. An invalid draft flips `submitted`,
// which drops the pristine grace everywhere and opens the issue list instead
// of saving. Leaving with unsaved changes asks first.

// The shared name rule (shared/utils/workflow.ts): the same regex the
// server's workflowInputSchema validates with.
const nameValid = computed(() => WORKFLOW_NAME_RE.test(draft.value.name.trim()))

// Everything blocking the save, one row per problem: the header's
// "Incomplete" popover lists these; clicking a row opens the affected step.
// `target` is the TOP-LEVEL step to reveal (sub-step problems name the
// offender in the text but expand their composite's card). `pristine` rows
// sit on a step (or name) the user hasn't started filling in: they still
// block the save but render as neutral to-dos, not errors.
interface DraftIssue { target?: WorkflowStep, pristine: boolean, text: string }
const draftIssues = computed<DraftIssue[]>(() => {
  const list: DraftIssue[] = []
  if (!nameValid.value) {
    const untouched = !draft.value.name.trim()
    list.push({
      pristine: untouched,
      text: untouched
        ? 'Give the workflow a name'
        : 'Name: only letters, numbers, spaces, hyphens and underscores',
    })
  }
  draft.value.steps.forEach((step, i) => {
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
// started configuring, or ALL of them once a save attempt failed.
const flaggedIssues = computed(() => draftIssues.value.filter(i => submitted.value || !i.pristine))
// Children (field highlights, sub-step borders) follow the same switch.
provide(FORCE_STEP_ISSUES, submitted)

// The header popover's open state, closed when a row jumps to its step.
const issuesOpen = ref(false)
function jumpToIssue(issue: DraftIssue) {
  issuesOpen.value = false
  if (issue.target) revealStep(issue.target)
}

function saveBody() {
  return { name: draft.value.name.trim(), description: draft.value.description, steps: toRaw(draft.value.steps) }
}

const draftJson = computed(() => JSON.stringify(draft.value))
const dirty = computed(() => draftJson.value !== original.value)

// A save error belongs to the attempt it came from: the next edit clears it.
watch(draftJson, () => {
  saveError.value = undefined
})

// Once every problem is fixed, drop back into the quiet (pristine-aware)
// mode: freshly added steps stay calm again until the next save attempt.
watch(valid, (ok) => {
  if (ok) submitted.value = false
})

// What the header shows next to the Save button.
const headerState = computed(() => {
  if (saving.value) return 'saving'
  if (saveError.value !== undefined) return 'error'
  if (!dirty.value) return saved.value ? 'saved' : 'idle'
  return valid.value ? 'unsaved' : 'incomplete'
})

async function save() {
  if (!editable.value || saving.value || !dirty.value) return
  // The fixed validation point: an invalid draft doesn't save, it shows
  // everything that's in the way instead.
  if (!valid.value) {
    submitted.value = true
    issuesOpen.value = true
    return
  }
  saving.value = true
  saveError.value = undefined
  try {
    if (!saved.value) {
      const created = await $fetch('/api/workflows', { method: 'POST', body: saveBody() })
      original.value = JSON.stringify(draft.value)
      skipReset = true
      await refresh()
      await navigateTo(`/workflows/${encodeURIComponent(created.name)}`)
    }
    else {
      // Typed explicitly: `/api/workflows/${string}` also matches the export
      // sub-route since it exists, which degrades Nitro's inference to unknown.
      const updated = await $fetch<{ name: string }>(`/api/workflows/${encodeURIComponent(saved.value.name)}`, { method: 'PATCH', body: saveBody() })
      original.value = JSON.stringify(draft.value)
      if (updated.name !== saved.value.name) {
        skipReset = true
        await refresh()
        await navigateTo(`/workflows/${encodeURIComponent(updated.name)}`)
      }
    }
  }
  catch (e) {
    saveError.value = errMsg(e, '')
  }
  finally {
    saving.value = false
  }
}

// Cmd/Ctrl+S saves; leaving with unsaved changes asks first (route change
// AND hard reload/close).
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    save()
  }
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) e.preventDefault()
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})
onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return window.confirm('You have unsaved changes. Leave without saving?')
})

// ── rename (existing workflows) ─────────────────────────────────────────────
// The title is a static heading; renaming is an explicit, atomic action so a
// stray keystroke can't rename-and-navigate mid-typing. The input binds a local
// value and only commits (one PATCH → reference cascade → navigate) on
// Enter/blur; Escape cancels.
const renaming = ref(false)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement>()
const renameValid = computed(() => WORKFLOW_NAME_RE.test(renameValue.value.trim()))

async function startRename() {
  renameValue.value = draft.value.name
  renaming.value = true
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}
function cancelRename() {
  renaming.value = false
}
async function commitRename() {
  if (!renaming.value) return
  renaming.value = false
  const next = renameValue.value.trim()
  if (!saved.value || next === saved.value.name || !renameValid.value) return
  // Renames PATCH the PERSISTED record (like toggleEnabled): an in-progress
  // step edit stays local and unsaved, exactly as it was.
  try {
    const updated = await $fetch<{ name: string }>(`/api/workflows/${encodeURIComponent(saved.value.name)}`, {
      method: 'PATCH',
      body: { name: next, description: saved.value.description, steps: saved.value.steps },
    })
    draft.value.name = updated.name
    // Keep the dirty diff honest: the baseline gets the new name too.
    const base = JSON.parse(original.value) as Draft
    base.name = updated.name
    original.value = JSON.stringify(base)
    skipReset = true
    await refresh()
    await navigateTo(`/workflows/${encodeURIComponent(updated.name)}`)
  }
  catch (e) {
    toast.add({ title: 'Rename failed', description: errMsg(e, ''), color: 'error' })
  }
}

const removing = ref(false)
async function removeWorkflow() {
  if (!saved.value) return
  removing.value = true
  try {
    const res = await $fetch<{ deletedTriggers: number }>(`/api/workflows/${encodeURIComponent(saved.value.name)}`, { method: 'DELETE' })
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

// ── per-step status ───────────────────────────────────────────────────────
type StepStatus = 'idle' | 'selected' | 'done' | 'running' | 'error' | 'pending' | 'skipped'

// The run's top-level step records (nested rows belong to composites), keyed
// by sequence position, shared by the per-card statuses and the banner.
const topRows = computed(() => new Map(
  activeRunSteps.value.filter(r => !r.parentStepId).map(r => [r.stepIndex, r])))

// Per-card status from the run's step records (run_steps, polled alongside the
// run): a top-level step's row is matched by its position in the sequence.
const statuses = computed<StepStatus[]>(() => {
  const run = activeRun.value
  if (!run) return steps.value.map(s => (openSteps.value.has(s) ? 'selected' : 'idle'))
  return steps.value.map((_, i) => {
    const row = topRows.value.get(i)
    if (!row) return run.status === 'failed' ? 'skipped' : 'pending'
    if (row.status === 'running') return 'running'
    if (row.status === 'failed') return 'error'
    return 'done'
  })
})

// 1-based "step N of M" for the live banner.
const startedSteps = computed(() => Math.max(1, topRows.value.size))

// The failed test's banner facts: the step that stopped the run (1-based
// position + label) and how many later steps never ran. A runner crash can
// leave the dying step's row on 'running', so that counts as the stopper too.
// Null when the run failed before its first step row; the log has the story.
const failedStep = computed(() => {
  if (mode.value !== 'failed') return null
  const i = statuses.value.findIndex(s => s === 'error' || s === 'running')
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

const railSteps = computed(() =>
  steps.value.map((step, i) => ({
    step,
    meta: workflowStepMeta(step),
    status: statuses.value[i]!,
    n: i + 1,
    // Only problems on touched steps light the card up (all of them after a
    // failed save); a just-added step keeps its neutral "Not configured yet".
    issues: stepIssues(step).filter(issue => submitted.value || !stepPristine(issue.step)),
  })),
)

// The card's one-line problem summary ("Command is required · +2 more"),
// naming the sub-step when the problem sits inside a composite.
function issueSummary(r: { step: WorkflowStep, issues: StepIssue[] }): string {
  const first = r.issues[0]!
  const text = first.step === r.step ? first.message : `${workflowStepMeta(first.step).label}: ${first.message}`
  return r.issues.length > 1 ? `${text} · +${r.issues.length - 1} more` : text
}

// status → card treatment (border / background / left accent / dim)
const TREAT: Record<StepStatus, { border: string, bg: string, accent: string | null, dim?: boolean }> = {
  idle: { border: 'var(--border-default)', bg: 'var(--surface-muted)', accent: null },
  selected: { border: 'var(--border-accented)', bg: 'var(--surface-muted)', accent: null },
  done: { border: 'var(--border-default)', bg: 'var(--surface-muted)', accent: 'var(--primary)' },
  running: { border: 'var(--accent-orange)', bg: 'color-mix(in oklab, var(--accent-orange) 10%, var(--surface-muted))', accent: 'var(--accent-orange)' },
  error: { border: 'var(--status-error)', bg: 'color-mix(in oklab, var(--status-error) 8%, var(--surface-muted))', accent: 'var(--status-error)' },
  pending: { border: 'var(--border-muted)', bg: 'color-mix(in oklab, var(--surface-muted) 60%, transparent)', accent: null, dim: true },
  skipped: { border: 'var(--border-muted)', bg: 'transparent', accent: null, dim: true },
}
const STATUS_LABEL: Partial<Record<StepStatus, { text: string, color: string }>> = {
  running: { text: 'running', color: 'var(--accent-orange)' },
  done: { text: 'done', color: 'var(--text-primary)' },
  error: { text: 'failed', color: 'var(--status-error)' },
  skipped: { text: 'skipped', color: 'var(--text-dimmed)' },
}

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
      <span class="k-mono truncate text-xs text-muted">{{ isNew ? 'New' : routeName }}</span>
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
      <div class="mb-4.5 flex items-start justify-between gap-5">
        <div class="flex min-w-0 flex-1 items-center gap-3.5">
          <KStepIcon
            icon="i-lucide-workflow"
            color="var(--text-primary)"
            :size="40"
            :radius="9"
          />
          <div class="min-w-0 flex-1">
            <!-- New draft: the name is entered directly (no identity yet). -->
            <input
              v-if="!saved && editable"
              v-model="draft.name"
              placeholder="Workflow name"
              spellcheck="false"
              class="k-mono w-full bg-transparent text-xl font-semibold tracking-tight text-highlighted outline-none"
              :class="submitted && !nameValid ? 'placeholder:text-(--accent-orange)' : 'placeholder:text-dimmed'"
            >
            <!-- Renaming an existing workflow: deliberate + atomic. -->
            <input
              v-else-if="renaming"
              ref="renameInput"
              v-model="renameValue"
              spellcheck="false"
              class="k-mono w-full bg-transparent text-xl font-semibold tracking-tight text-highlighted outline-none"
              @keyup.enter="commitRename"
              @keyup.esc="cancelRename"
              @blur="commitRename"
            >
            <!-- Saved: the title itself is the rename affordance, click it. -->
            <UTooltip
              v-else-if="saved && editable"
              text="Click to rename"
            >
              <h1
                tabindex="0"
                class="k-mono min-w-0 cursor-text truncate text-xl font-semibold tracking-tight text-highlighted outline-none transition-opacity hover:opacity-70"
                @click="startRename"
                @keyup.enter="startRename"
              >
                {{ saved?.name ?? draft.name }}
              </h1>
            </UTooltip>
            <h1
              v-else
              class="k-mono min-w-0 truncate text-xl font-semibold tracking-tight text-highlighted"
            >
              {{ saved?.name ?? draft.name }}
            </h1>
            <div class="mt-1.5 flex items-center gap-1.5">
              <UBadge
                v-if="mode === 'draft'"
                color="neutral"
                variant="subtle"
                size="sm"
                label="Draft"
              />
              <span
                v-else-if="mode === 'running'"
                class="k-mono flex items-center gap-1.5 text-2xs text-accent-orange"
              >
                <KStatusDot
                  color="orange"
                  pulse
                  :size="5"
                /> Test running
              </span>
              <span
                v-else-if="mode === 'success'"
                class="k-mono flex items-center gap-1.5 text-2xs text-primary"
              >
                <UIcon
                  name="i-lucide-check"
                  class="size-3.5"
                /> Test succeeded
              </span>
              <span
                v-else-if="mode === 'failed'"
                class="k-mono flex items-center gap-1.5 text-2xs text-error"
              >
                <KStatusDot
                  color="error"
                  :size="5"
                /> Test failed
              </span>
            </div>
          </div>
        </div>

        <div class="flex flex-none items-center gap-2.5">
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
              @click="() => { navigateTo(`/runs/${activeRun!.id}`) }"
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
            <!-- save state chip + the explicit Save button (Cmd/Ctrl+S) -->
            <span
              v-if="headerState === 'saved'"
              class="k-mono flex items-center gap-1.5 text-2xs text-dimmed"
            >
              <UIcon
                name="i-lucide-check"
                class="size-3.5 text-primary"
              /> Saved
            </span>
            <span
              v-else-if="headerState === 'unsaved'"
              class="k-mono flex items-center gap-1.5 text-2xs text-dimmed"
            >
              <span class="size-1.5 rounded-full bg-(--accent-orange)" /> Unsaved changes
            </span>
            <UPopover
              v-else-if="headerState === 'incomplete'"
              v-model:open="issuesOpen"
              :content="{ align: 'end' }"
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
                    {{ flaggedIssues.length ? 'Fix these to save:' : 'Left to fill in before this saves:' }}
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
            <UTooltip
              v-else-if="headerState === 'error'"
              :text="saveError"
            >
              <span class="k-mono flex items-center gap-1.5 text-2xs text-error">
                <UIcon
                  name="i-lucide-circle-x"
                  class="size-3.5"
                /> Not saved
              </span>
            </UTooltip>

            <UButton
              color="primary"
              :loading="saving"
              :disabled="!dirty"
              @click="save"
            >
              Save
              <template #trailing>
                <!-- Blend into the primary button: no solid chip background,
                     just the button's ink, dimmed. -->
                <span class="flex items-center gap-0.5 opacity-55">
                  <UKbd
                    value="meta"
                    class="bg-transparent text-current ring-current/40"
                  />
                  <UKbd
                    value="s"
                    class="bg-transparent text-current ring-current/40"
                  />
                </span>
              </template>
            </UButton>
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
        </div>
      </div>

      <!-- Description (editable) -->
      <input
        v-if="editable"
        v-model="draft.description"
        placeholder="Short description (optional)"
        class="mb-4.5 w-full bg-transparent text-2sm text-muted outline-none placeholder:text-dimmed"
      >

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
          @dragover="onRailOver"
          @drop.prevent="onRailDrop"
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
              <!-- Header + master switch: pauses every trigger at once (manual
                   runs / tests are unaffected). Only shown once a trigger is
                   configured: with just the implicit manual start there is
                   nothing the switch could pause. -->
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
                      {{ saved.enabled ? 'Triggers fire automatically' : 'Paused: triggers won’t fire' }}
                    </div>
                  </div>
                </div>
                <UTooltip :text="saved.enabled ? 'Pause automation' : 'Enable automation'">
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
                  v-model:open="open"
                  :content="{ side: 'bottom', align: 'end' }"
                >
                  <UTooltip
                    :text="!saved ? 'Save the workflow first' : dirty ? 'Save your changes first' : !valid ? 'Finish the step config first' : !projects?.length ? 'Connect a project first' : ''"
                    :disabled="!!saved && !dirty && valid && !!projects?.length"
                  >
                    <UButton
                      color="primary"
                      size="xs"
                      icon="i-lucide-play"
                      label="Run"
                      :disabled="!saved || dirty || saving || !valid || !projects?.length"
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

              <!-- Add another trigger (group footer) -->
              <UTooltip
                text="Save the workflow first"
                :disabled="!!saved"
                class="block"
              >
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2 border-t border-muted px-3 py-2.5 text-left text-xs text-muted transition-colors hover:bg-(--surface-glass) disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!saved || !editable"
                  @click="triggerModalOpen = true"
                >
                  <UIcon
                    name="i-lucide-plus"
                    class="size-4 flex-none text-dimmed"
                  />
                  Add trigger
                </button>
              </UTooltip>
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
              :style="{ borderColor: libDrag ? 'var(--primary)' : 'var(--border-accented)' }"
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

          <!-- Step rail -->
          <template
            v-for="(r, i) in railSteps"
            v-else
            :key="i"
          >
            <!-- library-drop insertion line -->
            <div
              v-if="libDrag && dropIndex === i"
              class="mb-3 ml-11 h-1 rounded-full bg-primary"
              style="box-shadow: 0 0 10px var(--primary)"
            />
            <div
              class="flex gap-3.5"
              :style="{ opacity: dragIndex === i ? 0.45 : TREAT[r.status].dim ? 0.55 : 1 }"
              :draggable="dragArmed === i"
              @dragstart="onDragStart(i, $event)"
              @dragover="onDragOver(i, $event)"
              @dragend="endDrag"
            >
              <div class="flex w-7.5 flex-none flex-col items-center">
                <!-- status mark -->
                <span
                  v-if="r.status === 'done'"
                  class="k-mono grid size-7.5 flex-none place-items-center rounded-full"
                  style="background: var(--lime-950); border: 1px solid var(--primary-border); color: var(--primary)"
                >
                  <UIcon
                    name="i-lucide-check"
                    class="size-4"
                  />
                </span>
                <span
                  v-else-if="r.status === 'running'"
                  class="grid size-7.5 flex-none place-items-center rounded-full"
                  style="background: color-mix(in oklab, var(--accent-orange) 20%, var(--surface-muted)); border: 1px solid var(--accent-orange)"
                >
                  <KStatusDot
                    color="orange"
                    pulse
                    :size="8"
                  />
                </span>
                <span
                  v-else-if="r.status === 'error'"
                  class="k-mono grid size-7.5 flex-none place-items-center rounded-full text-2sm font-semibold"
                  style="background: color-mix(in oklab, var(--status-error) 18%, var(--surface-muted)); border: 1px solid var(--status-error); color: var(--status-error)"
                >!</span>
                <span
                  v-else-if="r.status === 'skipped'"
                  class="k-mono grid size-7.5 flex-none place-items-center rounded-full border border-muted bg-(--surface-muted) text-dimmed"
                >–</span>
                <span
                  v-else
                  class="k-mono grid size-7.5 flex-none place-items-center rounded-full text-xs font-semibold"
                  :style="editable && r.issues.length
                    ? { background: 'color-mix(in oklab, var(--accent-orange) 12%, var(--surface-muted))', border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)' }
                    : r.status === 'selected'
                      ? { background: 'var(--surface-accented)', border: '1px solid var(--border-accented)', color: 'var(--text-toned)' }
                      : { background: 'var(--surface-muted)', border: '1px solid var(--border-accented)', color: 'var(--text-muted)' }"
                >{{ r.n }}</span>
                <span
                  v-if="i < railSteps.length - 1"
                  class="my-1 w-0.5 flex-1 rounded-sm bg-(--border-default)"
                  style="min-height: 16px"
                />
              </div>

              <!-- Card: summary row; clicking expands the settings inline. -->
              <div
                :id="`step-card-${r.step.id}`"
                class="relative mb-3 min-w-0 flex-1 overflow-hidden rounded-lg"
                :style="{ border: `1px solid ${editable && r.issues.length ? 'var(--accent-orange)' : openSteps.has(r.step) ? 'var(--border-accented)' : TREAT[r.status].border}`, background: TREAT[r.status].bg, boxShadow: 'var(--shadow-panel)' }"
              >
                <span
                  v-if="TREAT[r.status].accent"
                  class="absolute inset-y-0 left-0 z-10 w-1"
                  :style="{ background: TREAT[r.status].accent! }"
                />
                <div class="group/row flex items-center gap-2.5 py-2.5 pl-2.5 pr-3">
                  <!-- drag grip: arms the row for HTML5 dragging -->
                  <span
                    v-if="editable"
                    class="flex-none cursor-grab text-dimmed transition-colors hover:text-muted active:cursor-grabbing"
                    aria-label="Drag to reorder"
                    @mousedown="dragArmed = i"
                    @mouseup="dragArmed = null"
                  >
                    <UIcon
                      name="i-lucide-grip-vertical"
                      class="size-4"
                    />
                  </span>
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-3 text-left"
                    :aria-label="openSteps.has(r.step) ? 'Collapse settings' : 'Open settings'"
                    @click="toggleStep(r.step)"
                  >
                    <KStepIcon
                      :icon="r.meta.icon"
                      :color="STEP_KIND_COLOR[r.meta.kind]"
                      :size="34"
                      :radius="8"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block whitespace-nowrap text-sm font-medium text-highlighted">{{ r.meta.label }}</span>
                      <span
                        class="mt-1 block truncate text-xs"
                        :style="{ color: r.status === 'error' ? 'var(--status-error)' : editable && r.issues.length ? 'var(--accent-orange)' : 'var(--text-muted)' }"
                      >
                        {{ editable && r.issues.length ? issueSummary(r) : (r.meta.detail || 'Not configured yet') }}
                      </span>
                    </span>
                  </button>
                  <span
                    v-if="STATUS_LABEL[r.status]"
                    class="k-mono flex-none text-3xs uppercase tracking-widest"
                    :style="{ color: STATUS_LABEL[r.status]!.color }"
                  >{{ STATUS_LABEL[r.status]!.text }}</span>
                  <UButton
                    v-if="editable"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-trash-2"
                    aria-label="Remove step"
                    class="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
                    @click="removeStep(i)"
                  />
                  <UIcon
                    name="i-lucide-chevron-down"
                    class="size-4 flex-none cursor-pointer text-dimmed transition-transform duration-300"
                    :class="{ 'rotate-180': openSteps.has(r.step) }"
                    @click="toggleStep(r.step)"
                  />
                </div>

                <!-- inline settings, animated open/closed -->
                <div
                  class="grid transition-[grid-template-rows] duration-300 ease-out"
                  :style="{ gridTemplateRows: openSteps.has(r.step) ? '1fr' : '0fr' }"
                >
                  <div class="overflow-hidden">
                    <WorkflowStepSettings
                      v-if="openSteps.has(r.step)"
                      :step="r.step"
                      :groups="availableVars(steps, i)"
                      :editable="editable"
                      :root="steps"
                      :depth="1"
                    />
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Add-step affordance under the rail (also the append drop zone) -->
          <div
            v-if="editable && steps.length"
            class="flex flex-col"
            @dragover.prevent="libDrag && (dropIndex = steps.length)"
          >
            <div
              v-if="libDrag && dropIndex === steps.length"
              class="mb-3 ml-11 h-1 rounded-full bg-primary"
              style="box-shadow: 0 0 10px var(--primary)"
            />
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
            >
              <template #action>
                <span class="k-mono text-3xs text-dimmed">run #{{ activeRun.id }}</span>
              </template>
              <KLogView
                :log="activeRun.log"
                :max-height="340"
                class="text-2xs leading-loose"
              />
            </KPanel>

            <KPanel
              v-else-if="mode === 'success'"
              title="Run result"
              icon="i-lucide-check"
              accent="var(--primary)"
            >
              <div class="flex flex-col gap-3.5">
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
                <KLogView
                  :log="activeRun.log"
                  :max-height="260"
                  class="text-2xs leading-loose"
                />
              </div>
            </KPanel>

            <KPanel
              v-else
              title="Error details"
              icon="i-lucide-flask-conical"
              accent="var(--status-error)"
            >
              <div class="flex flex-col gap-3.5">
                <div class="flex items-center justify-between">
                  <span class="k-mono text-2xs text-dimmed">Failed at step</span>
                  <span class="k-mono text-2xs text-error">{{ failedStep ? `${failedStep.n} of ${steps.length}` : 'before step 1' }}</span>
                </div>
                <KLogView
                  :log="activeRun.log"
                  :max-height="340"
                  class="rounded-md border border-muted bg-(--surface-base) p-3 text-2xs leading-relaxed"
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
            @drag="type => libDrag = type"
            @dragend="endDrag"
          />
        </div>
      </div>
    </template>

    <TriggerCreateModal
      v-model:open="triggerModalOpen"
      :preset-workflow="saved?.name"
      :trigger="editingTrigger"
      @created="refreshTriggers"
    />

    <KConfirmModal
      v-model:open="confirmDelete"
      title="Delete workflow"
      :description="`Deletes ${saved?.name ?? draft.name} along with its configured triggers.`"
      confirm-label="Delete"
      :loading="removing"
      @confirm="removeWorkflow"
    />
  </div>
</template>
