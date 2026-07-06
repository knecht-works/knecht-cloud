<script setup lang="ts">
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
// Which steps have their settings expanded: several can be open at once.
// Tracked by step OBJECT (not index), so the open state survives reordering.
const openSteps = ref(new Set<WorkflowStep>())

function toggleStep(step: WorkflowStep) {
  if (openSteps.value.has(step)) openSteps.value.delete(step)
  else openSteps.value.add(step)
}

function resetDraft() {
  const base: Draft = saved.value
    ? { name: saved.value.name, description: saved.value.description, steps: structuredClone(toRaw(saved.value.steps)) as WorkflowStep[] }
    : { name: '', description: '', steps: [] }
  draft.value = base
  original.value = JSON.stringify(base)
  openSteps.value.clear()
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
const { open, project, starting, activeRun, activeRunSteps, testBranch, testBranchItems, start, detach, retest }
  = useWorkflowTestRun<(typeof projects.value)[number]>(() => saved.value?.name, () => openSteps.value.clear())

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

// ── export (a browser download; the endpoint sets content-disposition) ──────
const exportItems = computed(() => (['yaml', 'json'] as const).map(format => ({
  label: format.toUpperCase(),
  icon: 'i-lucide-file-down',
  onSelect: () => {
    if (saved.value) window.location.assign(`/api/workflows/${encodeURIComponent(saved.value.name)}/export?format=${format}`)
  },
})))

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

// ── auto-save ────────────────────────────────────────────────────────────────
// There's no save button: edits persist automatically (debounced) once the
// workflow is valid. New workflows are created as soon as they have a valid name
// and at least one filled step; before that they stay an in-memory draft.
type SaveStatus = 'idle' | 'saving' | 'saved' | 'invalid' | 'error'
const saveStatus = ref<SaveStatus>('idle')
const saveError = ref<string>()

// The shared name rule (shared/utils/workflow.ts): the same regex the
// server's workflowInputSchema validates with.
const nameValid = computed(() => WORKFLOW_NAME_RE.test(draft.value.name.trim()))
const valid = computed(() => nameValid.value && draft.value.steps.every(stepValid))

function saveBody() {
  return { name: draft.value.name.trim(), description: draft.value.description, steps: toRaw(draft.value.steps) }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(() => JSON.stringify(draft.value), (now) => {
  if (activeRun.value) return
  clearTimeout(saveTimer)
  if (now === original.value) {
    saveStatus.value = 'saved'
    return
  }
  if (!valid.value) {
    saveStatus.value = 'invalid'
    return
  }
  saveStatus.value = 'saving'
  saveTimer = setTimeout(persist, 700)
})

async function persist() {
  if (!valid.value) {
    saveStatus.value = 'invalid'
    return
  }
  try {
    if (!saved.value) {
      // Don't create an empty shell: wait until there's a step worth saving.
      if (!draft.value.steps.length) {
        saveStatus.value = 'idle'
        return
      }
      const created = await $fetch('/api/workflows', { method: 'POST', body: saveBody() })
      original.value = JSON.stringify(draft.value)
      saveStatus.value = 'saved'
      skipReset = true
      await refresh()
      await navigateTo(`/workflows/${encodeURIComponent(created.name)}`)
    }
    else {
      // Typed explicitly: `/api/workflows/${string}` also matches the export
      // sub-route since it exists, which degrades Nitro's inference to unknown.
      const updated = await $fetch<{ name: string }>(`/api/workflows/${encodeURIComponent(saved.value.name)}`, { method: 'PATCH', body: saveBody() })
      original.value = JSON.stringify(draft.value)
      saveStatus.value = 'saved'
      if (updated.name !== saved.value.name) {
        skipReset = true
        await refresh()
        await navigateTo(`/workflows/${encodeURIComponent(updated.name)}`)
      }
    }
  }
  catch (e) {
    saveStatus.value = 'error'
    saveError.value = errMsg(e, '')
  }
}

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
  if (next === draft.value.name || !renameValid.value) return
  const prev = draft.value.name
  draft.value.name = next
  clearTimeout(saveTimer)
  await persist()
  // Rename failed (e.g. the name is taken) → keep the current identity. The
  // rest of the workflow is unchanged, so clear the transient error state.
  if (saveStatus.value === 'error') {
    toast.add({ title: 'Rename failed', description: saveError.value, color: 'error' })
    draft.value.name = prev
    saveStatus.value = 'saved'
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

// Flush a pending edit (PATCH only, no navigation) when leaving the page.
onUnmounted(() => {
  clearTimeout(saveTimer)
  if (saved.value && valid.value && JSON.stringify(draft.value) !== original.value) {
    $fetch(`/api/workflows/${encodeURIComponent(saved.value.name)}`, { method: 'PATCH', body: saveBody() }).catch(() => {})
  }
})

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

const railSteps = computed(() =>
  steps.value.map((step, i) => ({ step, meta: workflowStepMeta(step), status: statuses.value[i]!, n: i + 1 })),
)

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

const logTail = computed(() => (activeRun.value?.log ?? '').trimEnd().split('\n').slice(-14).join('\n'))
</script>

<template>
  <div>
    <div class="mb-3.5 flex items-center gap-2 text-(--text-dimmed)">
      <NuxtLink
        to="/workflows"
        class="k-mono text-xs transition-colors hover:text-(--text-muted)"
      >
        Workflows
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <span class="k-mono truncate text-xs text-(--text-muted)">{{ isNew ? 'New' : routeName }}</span>
    </div>

    <div
      v-if="notFound"
      class="k-card flex flex-col items-center gap-3 px-6 py-14 text-center"
    >
      <UIcon
        name="i-lucide-workflow"
        class="size-7 text-(--text-dimmed)"
      />
      <p class="text-[13px] text-(--text-muted)">
        Workflow not found.
        <NuxtLink
          to="/workflows"
          class="text-(--text-primary) hover:underline"
        >Back to workflows</NuxtLink>
      </p>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="mb-[18px] flex items-start justify-between gap-5">
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
              class="k-mono w-full bg-transparent text-xl font-semibold tracking-[-0.02em] text-(--text-highlighted) outline-none placeholder:text-(--text-dimmed)"
            >
            <!-- Renaming an existing workflow: deliberate + atomic. -->
            <input
              v-else-if="renaming"
              ref="renameInput"
              v-model="renameValue"
              spellcheck="false"
              class="k-mono w-full bg-transparent text-xl font-semibold tracking-[-0.02em] text-(--text-highlighted) outline-none"
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
                class="k-mono min-w-0 cursor-text truncate text-xl font-semibold tracking-[-0.02em] text-(--text-highlighted) outline-none transition-opacity hover:opacity-70"
                @click="startRename"
                @keyup.enter="startRename"
              >
                {{ saved?.name ?? draft.name }}
              </h1>
            </UTooltip>
            <h1
              v-else
              class="k-mono min-w-0 truncate text-xl font-semibold tracking-[-0.02em] text-(--text-highlighted)"
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
                class="k-mono flex items-center gap-1.5 text-[11px] text-(--accent-orange)"
              >
                <KStatusDot
                  color="orange"
                  pulse
                  :size="5"
                /> Test running
              </span>
              <span
                v-else-if="mode === 'success'"
                class="k-mono flex items-center gap-1.5 text-[11px] text-(--text-primary)"
              >
                <UIcon
                  name="i-lucide-check"
                  class="size-[13px]"
                /> Test succeeded
              </span>
              <span
                v-else-if="mode === 'failed'"
                class="k-mono flex items-center gap-1.5 text-[11px] text-(--status-error)"
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
              color="neutral"
              variant="outline"
              label="Cancel"
              @click="detach"
            />
            <UButton
              color="neutral"
              variant="ghost"
              label="Run in background"
              @click="() => { navigateTo(`/runs/${activeRun!.id}`) }"
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
            <UButton
              color="primary"
              icon="i-lucide-refresh-cw"
              label="Test again"
              @click="retest"
            />
          </template>
          <template v-else>
            <!-- auto-save status (no save button) -->
            <span
              v-if="saveStatus === 'saving'"
              class="k-mono flex items-center gap-1.5 text-[11px] text-(--text-dimmed)"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-3.5 animate-spin"
              /> Saving…
            </span>
            <span
              v-else-if="saveStatus === 'saved'"
              class="k-mono flex items-center gap-1.5 text-[11px] text-(--text-dimmed)"
            >
              <UIcon
                name="i-lucide-check"
                class="size-3.5 text-(--text-primary)"
              /> Saved
            </span>
            <UTooltip
              v-else-if="saveStatus === 'invalid'"
              text="Give it a name and fill in every step's fields to save"
            >
              <span class="k-mono flex items-center gap-1.5 text-[11px] text-(--accent-orange)">
                <UIcon
                  name="i-lucide-circle-alert"
                  class="size-3.5"
                /> Incomplete
              </span>
            </UTooltip>
            <UTooltip
              v-else-if="saveStatus === 'error'"
              :text="saveError"
            >
              <span class="k-mono flex items-center gap-1.5 text-[11px] text-(--status-error)">
                <UIcon
                  name="i-lucide-circle-x"
                  class="size-3.5"
                /> Not saved
              </span>
            </UTooltip>

            <UDropdownMenu
              v-if="saved"
              :items="exportItems"
            >
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-download"
                label="Export"
              />
            </UDropdownMenu>
            <UButton
              v-if="saved"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              label="Delete"
              :loading="removing"
              @click="removeWorkflow"
            />
          </template>
        </div>
      </div>

      <!-- Description (editable) -->
      <input
        v-if="editable"
        v-model="draft.description"
        placeholder="Short description (optional)"
        class="mb-[18px] w-full bg-transparent text-[13.5px] text-(--text-muted) outline-none placeholder:text-(--text-dimmed)"
      >

      <!-- Banner -->
      <div
        v-if="mode === 'running'"
        class="mb-[18px] overflow-hidden rounded-(--radius-lg) border"
        style="border-color: color-mix(in oklab, var(--accent-orange) 40%, transparent); background: color-mix(in oklab, var(--accent-orange) 10%, transparent)"
      >
        <div class="flex items-center gap-3 px-4 py-3.5">
          <UIcon
            name="i-lucide-play"
            class="size-[17px] flex-none text-(--accent-orange)"
          />
          <div class="text-[13.5px] leading-[1.4] text-(--text-toned)">
            Test run in the real project · <b>Step {{ startedSteps }} of {{ steps.length }}</b> · executing…
          </div>
        </div>
        <div class="h-[3px] bg-(--surface-accented)">
          <div
            class="h-full bg-(--accent-orange)"
            :style="{ width: `${(startedSteps / steps.length) * 100}%`, boxShadow: '0 0 12px var(--accent-orange)' }"
          />
        </div>
      </div>
      <div
        v-else-if="mode === 'success'"
        class="mb-[18px] flex items-center gap-3 rounded-(--radius-lg) border px-4 py-3.5"
        style="border-color: var(--primary-border); background: color-mix(in oklab, var(--primary) 10%, transparent)"
      >
        <UIcon
          name="i-lucide-check"
          class="size-[17px] flex-none text-(--primary)"
        />
        <div class="text-[13.5px] leading-[1.4] text-(--text-toned)">
          <b>Test succeeded.</b> All {{ steps.length }} steps green<template v-if="pr">
            · Pull Request #{{ pr.number }} created
          </template> · runtime {{ fmtDuration(activeRun!.startedAt, activeRun!.finishedAt) }}
        </div>
      </div>
      <div
        v-else-if="mode === 'failed'"
        class="mb-[18px] flex items-center gap-3 rounded-(--radius-lg) border px-4 py-3.5"
        style="border-color: color-mix(in oklab, var(--status-error) 45%, transparent); background: color-mix(in oklab, var(--status-error) 12%, transparent)"
      >
        <UIcon
          name="i-lucide-flask-conical"
          class="size-[17px] flex-none text-(--status-error)"
        />
        <div class="text-[13.5px] leading-[1.4] text-(--text-toned)">
          <b>Test failed at step {{ startedSteps }}.</b> The following steps were skipped.
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
            <div class="flex w-[30px] flex-none flex-col items-center">
              <span
                class="grid size-[30px] flex-none place-items-center rounded-full"
                style="background: color-mix(in oklab, var(--accent-violet) 16%, var(--surface-muted)); border: 1px solid color-mix(in oklab, var(--accent-violet) 55%, transparent)"
              >
                <UIcon
                  name="i-lucide-zap"
                  class="size-[15px] text-(--accent-violet)"
                />
              </span>
              <span
                class="my-1 w-0.5 flex-1 rounded-sm bg-(--border-default)"
                style="min-height: 16px"
              />
            </div>

            <div
              class="min-w-0 flex-1 overflow-hidden rounded-(--radius-lg) border border-(--border-default) bg-(--surface-muted)"
              style="box-shadow: var(--shadow-panel)"
            >
              <!-- Header + master switch: pauses every trigger at once (manual
                   runs / tests are unaffected). Only shown once a trigger is
                   configured: with just the implicit manual start there is
                   nothing the switch could pause. -->
              <div
                v-if="saved && workflowTriggers.length"
                class="flex items-center justify-between gap-3 border-b border-(--border-muted) px-4 py-2.5 transition-colors"
                :style="saved.enabled ? {} : { background: 'color-mix(in oklab, var(--accent-orange) 9%, transparent)' }"
              >
                <div class="flex min-w-0 items-center gap-2.5">
                  <UIcon
                    :name="saved.enabled ? 'i-lucide-zap' : 'i-lucide-pause'"
                    class="size-4 flex-none transition-colors"
                    :class="saved.enabled ? 'text-(--text-dimmed)' : 'text-(--accent-orange)'"
                  />
                  <div class="min-w-0">
                    <div class="text-[13px] font-medium text-(--text-highlighted)">
                      Automation
                    </div>
                    <div
                      class="k-mono truncate text-[11px] transition-colors"
                      :class="saved.enabled ? 'text-(--text-dimmed)' : 'text-(--accent-orange)'"
                    >
                      {{ saved.enabled ? 'Triggers fire automatically' : 'Paused: triggers won’t fire' }}
                    </div>
                  </div>
                </div>
                <UTooltip :text="saved.enabled ? 'Pause automation' : 'Enable automation'">
                  <button
                    type="button"
                    :aria-label="saved.enabled ? 'Pause automation' : 'Enable automation'"
                    :disabled="togglingEnabled"
                    class="relative h-[19px] w-[34px] flex-none cursor-pointer rounded-full border border-(--border-default) transition-colors"
                    :style="{ background: saved.enabled ? 'var(--primary)' : 'var(--surface-accented)' }"
                    @click="toggleEnabled"
                  >
                    <span
                      class="absolute top-0.5 size-[13px] rounded-full transition-all"
                      :style="{ left: saved.enabled ? '17px' : '2px', background: saved.enabled ? 'var(--accent-ink)' : 'var(--text-dimmed)' }"
                    />
                  </button>
                </UTooltip>
              </div>

              <!-- Configured triggers (divided rows within the group). Dimmed
                   when the row is paused individually OR the master switch is
                   off, so a paused automation is visibly inert. -->
              <div
                v-for="t in workflowTriggers"
                :key="t.id"
                class="flex items-center gap-3 border-b border-(--border-muted) px-3 py-2.5 transition-opacity"
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
                    <span class="block text-[13px] text-(--text-highlighted)">
                      {{ triggerSourceMeta(t.source).label }}
                    </span>
                    <span class="k-mono block truncate text-[11px] text-(--text-dimmed) transition-colors group-hover:text-(--text-muted)">
                      {{ t.event }} · {{ t.projects.length ? t.projects.join(', ') : 'no projects' }}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  :aria-label="t.active ? 'Pause trigger' : 'Activate trigger'"
                  :disabled="!editable"
                  class="relative h-[19px] w-[34px] flex-none cursor-pointer rounded-full border border-(--border-default) transition-colors"
                  :style="{ background: t.active ? 'var(--primary)' : 'var(--surface-accented)' }"
                  @click="toggleTrigger(t)"
                >
                  <span
                    class="absolute top-0.5 size-[13px] rounded-full transition-all"
                    :style="{ left: t.active ? '17px' : '2px', background: t.active ? 'var(--accent-ink)' : 'var(--text-dimmed)' }"
                  />
                </button>
                <UButton
                  color="error"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-trash-2"
                  aria-label="Delete trigger"
                  :disabled="!editable"
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
                  <div class="text-[13px] text-(--text-highlighted)">
                    Manual
                  </div>
                  <div class="k-mono truncate text-[11px] text-(--text-dimmed)">
                    always available · run on demand
                  </div>
                </div>
                <UPopover
                  v-model:open="open"
                  :content="{ side: 'bottom', align: 'end' }"
                >
                  <UTooltip
                    :text="!saved ? 'Add a name and a step first' : !valid ? 'Finish the step config first' : !projects?.length ? 'Connect a project first' : ''"
                    :disabled="!!saved && valid && !!projects?.length"
                  >
                    <UButton
                      color="primary"
                      size="xs"
                      icon="i-lucide-play"
                      label="Run"
                      :disabled="!saved || !valid || saveStatus === 'saving' || !projects?.length"
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
                  class="flex w-full cursor-pointer items-center gap-2 border-t border-(--border-muted) px-3 py-2.5 text-left text-[12.5px] text-(--text-muted) transition-colors hover:bg-(--surface-glass) disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!saved || !editable"
                  @click="triggerModalOpen = true"
                >
                  <UIcon
                    name="i-lucide-plus"
                    class="size-4 flex-none text-(--text-dimmed)"
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
            <div class="flex w-[30px] flex-none justify-center">
              <span class="grid size-[30px] place-items-center rounded-full border border-dashed border-(--border-accented) text-(--text-dimmed)">
                <UIcon
                  name="i-lucide-plus"
                  class="size-[15px]"
                />
              </span>
            </div>
            <div
              class="flex flex-1 flex-col items-center gap-4 rounded-(--radius-lg) border border-dashed bg-(--surface-glass) px-6 py-9 text-center"
              :style="{ borderColor: libDrag ? 'var(--primary)' : 'var(--border-accented)' }"
            >
              <img
                src="/mascot/mascotRight.png"
                alt="Knecht"
                class="h-auto w-[76px]"
                style="filter: var(--drop-shadow-mascot)"
              >
              <div>
                <div class="text-[15px] font-medium text-(--text-toned)">
                  No steps yet
                </div>
                <div class="mx-auto mt-1.5 max-w-[320px] text-[13px] text-(--text-muted)">
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
              class="mb-3 ml-[44px] h-[3px] rounded-full bg-(--primary)"
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
              <div class="flex w-[30px] flex-none flex-col items-center">
                <!-- status mark -->
                <span
                  v-if="r.status === 'done'"
                  class="k-mono grid size-[30px] flex-none place-items-center rounded-full"
                  style="background: var(--lime-950); border: 1px solid var(--primary-border); color: var(--primary)"
                >
                  <UIcon
                    name="i-lucide-check"
                    class="size-[15px]"
                  />
                </span>
                <span
                  v-else-if="r.status === 'running'"
                  class="grid size-[30px] flex-none place-items-center rounded-full"
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
                  class="k-mono grid size-[30px] flex-none place-items-center rounded-full text-[13px] font-semibold"
                  style="background: color-mix(in oklab, var(--status-error) 18%, var(--surface-muted)); border: 1px solid var(--status-error); color: var(--status-error)"
                >!</span>
                <span
                  v-else-if="r.status === 'skipped'"
                  class="k-mono grid size-[30px] flex-none place-items-center rounded-full border border-(--border-muted) bg-(--surface-muted) text-(--text-dimmed)"
                >–</span>
                <span
                  v-else
                  class="k-mono grid size-[30px] flex-none place-items-center rounded-full text-xs font-semibold"
                  :style="r.status === 'selected'
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
                class="relative mb-3 min-w-0 flex-1 overflow-hidden rounded-(--radius-lg)"
                :style="{ border: `1px solid ${openSteps.has(r.step) ? 'var(--border-accented)' : TREAT[r.status].border}`, background: TREAT[r.status].bg, boxShadow: 'var(--shadow-panel)' }"
              >
                <span
                  v-if="TREAT[r.status].accent"
                  class="absolute inset-y-0 left-0 z-10 w-[3px]"
                  :style="{ background: TREAT[r.status].accent! }"
                />
                <div class="flex items-center gap-2.5 py-[11px] pl-2.5 pr-3">
                  <!-- drag grip: arms the row for HTML5 dragging -->
                  <span
                    v-if="editable"
                    class="flex-none cursor-grab text-(--text-dimmed) transition-colors hover:text-(--text-muted) active:cursor-grabbing"
                    aria-label="Drag to reorder"
                    @mousedown="dragArmed = i"
                    @mouseup="dragArmed = null"
                  >
                    <UIcon
                      name="i-lucide-grip-vertical"
                      class="size-[15px]"
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
                      <span class="block whitespace-nowrap text-sm font-medium text-(--text-highlighted)">{{ r.meta.label }}</span>
                      <span
                        class="mt-[3px] block truncate text-xs"
                        :style="{ color: r.status === 'error' ? 'var(--status-error)' : 'var(--text-muted)' }"
                      >
                        {{ r.meta.detail || 'Not configured yet' }}
                      </span>
                    </span>
                  </button>
                  <span
                    v-if="STATUS_LABEL[r.status]"
                    class="k-mono flex-none text-[10.5px] uppercase tracking-[0.08em]"
                    :style="{ color: STATUS_LABEL[r.status]!.color }"
                  >{{ STATUS_LABEL[r.status]!.text }}</span>
                  <UButton
                    v-if="editable"
                    color="error"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-trash-2"
                    aria-label="Remove step"
                    @click="removeStep(i)"
                  />
                  <UIcon
                    name="i-lucide-chevron-down"
                    class="size-[16px] flex-none cursor-pointer text-(--text-dimmed) transition-transform duration-300"
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
              class="mb-3 ml-[44px] h-[3px] rounded-full bg-(--primary)"
              style="box-shadow: 0 0 10px var(--primary)"
            />
            <div class="flex gap-3.5">
              <div class="w-[30px] flex-none" />
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
            class="ml-[44px] mt-1"
          >
            <KPanel
              v-if="mode === 'running'"
              title="Live log"
              icon="i-lucide-terminal"
              accent="var(--accent-orange)"
            >
              <template #action>
                <span class="k-mono text-[10.5px] text-(--text-dimmed)">run #{{ activeRun.id }}</span>
              </template>
              <pre class="k-mono max-h-[340px] overflow-auto whitespace-pre-wrap text-[11.5px] leading-[1.9] text-(--text-muted)">{{ logTail || '…' }}</pre>
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
                  class="flex items-center gap-3 rounded-(--radius-md) border p-3"
                  style="border-color: var(--primary-border); background: color-mix(in oklab, var(--primary) 7%, transparent)"
                >
                  <KStepIcon
                    icon="i-lucide-git-pull-request"
                    color="var(--primary)"
                    :size="30"
                    :radius="7"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="text-[13px] text-(--text-default)">
                      Pull Request #{{ pr.number }}
                    </div>
                    <span class="k-mono text-[11px] text-(--text-dimmed)">view on GitHub</span>
                  </div>
                  <UIcon
                    name="i-lucide-external-link"
                    class="size-[15px] text-(--text-dimmed)"
                  />
                </a>
                <div class="flex items-center gap-6">
                  <span class="k-mono text-[11.5px] text-(--text-dimmed)">Steps <span class="text-(--text-primary)">{{ steps.length }} / {{ steps.length }}</span></span>
                  <span class="k-mono text-[11.5px] text-(--text-dimmed)">Runtime <span class="text-(--text-toned)">{{ fmtDuration(activeRun.startedAt, activeRun.finishedAt) }}</span></span>
                </div>
                <pre class="k-mono max-h-[260px] overflow-auto whitespace-pre-wrap text-[11.5px] leading-[1.85] text-(--text-muted)">{{ logTail }}</pre>
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
                  <span class="k-mono text-[11.5px] text-(--text-dimmed)">Failed at step</span>
                  <span class="k-mono text-[11.5px] text-(--status-error)">{{ startedSteps }} of {{ steps.length }}</span>
                </div>
                <pre class="k-mono max-h-[340px] overflow-auto whitespace-pre-wrap rounded-(--radius-md) border border-(--border-muted) bg-(--surface-base) p-3 text-[11.5px] leading-[1.7] text-(--text-muted)">{{ logTail || '-' }}</pre>
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
  </div>
</template>
