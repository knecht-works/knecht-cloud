<script setup lang="ts">
// The workflow create/edit surface. A numbered step rail on the left (editable:
// add from the library, reorder, remove, edit each step's params) and a context
// panel on the right. Edits live in a local `draft` and persist via the
// workflows CRUD API. An inline test run overlays per-step progress derived from
// the run log's `▶ <step>` markers — no extra backend tracking.

const route = useRoute()
const toast = useToast()

const isNew = computed(() => String(route.params.name) === 'new')
const routeName = computed(() => decodeURIComponent(String(route.params.name)))

const { data: workflows, refresh } = await useFetch('/api/workflows', { default: () => [] })
const { data: projects } = await useFetch('/api/projects', {
  default: () => [],
  transform: rows => rows.map(p => ({ ...p, label: p.fullName })),
})

// The persisted record (null for a new draft or an unknown name).
const saved = computed(() => isNew.value ? null : (workflows.value?.find(w => w.name === routeName.value) ?? null))
const notFound = computed(() => !isNew.value && !saved.value)

// ── editable draft ─────────────────────────────────────────────────────────
interface Draft { name: string, description: string, steps: WorkflowStep[] }
const draft = ref<Draft>({ name: '', description: '', steps: [] })
const original = ref('')
const selected = ref<number | null>(null) // which step's inspector is open

function resetDraft() {
  const base: Draft = saved.value
    ? { name: saved.value.name, description: saved.value.description, steps: structuredClone(toRaw(saved.value.steps)) as WorkflowStep[] }
    : { name: '', description: '', steps: [] }
  draft.value = base
  original.value = JSON.stringify(base)
  selected.value = null
}
resetDraft()
// Re-init only when navigating to a different workflow — NOT when the list
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
const editable = computed(() => !activeRun.value)

// ── step library + mutations ────────────────────────────────────────────────
const LIBRARY = [
  { group: 'Deterministic', kind: 'det' as const, items: [
    { type: 'ddev-start', icon: 'i-lucide-play', label: 'Boot project' },
    { type: 'bash', icon: 'i-lucide-terminal', label: 'Shell command' },
  ] },
  { group: 'Output', kind: 'out' as const, items: [
    { type: 'create-branch', icon: 'i-lucide-git-branch', label: 'Create branch' },
    { type: 'create-commit', icon: 'i-lucide-git-commit-horizontal', label: 'Create commit' },
    { type: 'create-pr', icon: 'i-lucide-git-pull-request', label: 'Pull request' },
  ] },
]
const LIB_DOT: Record<string, 'primary' | 'orange' | 'neutral'> = { det: 'neutral', ai: 'orange', out: 'primary' }

function defaultStep(type: WorkflowStep['type']): WorkflowStep {
  switch (type) {
    case 'bash': return { type: 'bash', command: '', continueOnError: false }
    case 'create-branch': return { type: 'create-branch', name: '' }
    case 'create-commit': return { type: 'create-commit', message: '' }
    case 'create-pr': return { type: 'create-pr', title: '', body: '' }
    default: return { type: 'ddev-start' }
  }
}
function addStep(type: WorkflowStep['type']) {
  draft.value.steps.push(defaultStep(type))
  selected.value = draft.value.steps.length - 1
}
function removeStep(i: number) {
  draft.value.steps.splice(i, 1)
  selected.value = null
}
// Inline label/description edits write to the step; the field falls back to the
// derived label/detail when left empty (see workflowStepMeta).
function setStepLabel(step: WorkflowStep, e: Event) {
  step.label = (e.target as HTMLInputElement).value
}
function setStepDescription(step: WorkflowStep, e: Event) {
  step.description = (e.target as HTMLInputElement).value
}
function moveStep(i: number, dir: -1 | 1) {
  const j = i + dir
  const s = draft.value.steps
  if (j < 0 || j >= s.length) return
  ;[s[i], s[j]] = [s[j]!, s[i]!]
  if (selected.value === i) selected.value = j
  else if (selected.value === j) selected.value = i
}

function errMsg(e: unknown) {
  return (e as { data?: { statusMessage?: string } }).data?.statusMessage
}

// ── auto-save ────────────────────────────────────────────────────────────────
// There's no save button — edits persist automatically (debounced) once the
// workflow is valid. New workflows are created as soon as they have a valid name
// and at least one filled step; before that they stay an in-memory draft.
type SaveStatus = 'idle' | 'saving' | 'saved' | 'invalid' | 'error'
const saveStatus = ref<SaveStatus>('idle')
const saveError = ref<string>()
// A built-in we've created an override for this session — so "Reset to default"
// shows immediately without re-fetching the flags.
const localOverridden = ref(false)
const overridden = computed(() => !!saved.value?.overridden || localOverridden.value)

function stepValid(s: WorkflowStep): boolean {
  switch (s.type) {
    case 'bash': return !!s.command.trim()
    case 'create-branch': return !!s.name.trim()
    case 'create-commit': return !!s.message.trim()
    case 'create-pr': return !!s.title.trim()
    default: return true
  }
}
const nameValid = computed(() => /^[a-z0-9][a-z0-9-]*$/.test(draft.value.name.trim()))
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
      // Don't create an empty shell — wait until there's a step worth saving.
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
      const updated = await $fetch(`/api/workflows/${encodeURIComponent(saved.value.name)}`, { method: 'PATCH', body: saveBody() })
      if (saved.value.builtin) localOverridden.value = true
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
    saveError.value = errMsg(e)
  }
}

const removing = ref(false)
async function removeWorkflow() {
  if (!saved.value) return
  const wasBuiltin = saved.value.builtin
  removing.value = true
  try {
    await $fetch(`/api/workflows/${encodeURIComponent(saved.value.name)}`, { method: 'DELETE' })
    await refresh()
    if (wasBuiltin) {
      toast.add({ title: 'Reset to default', color: 'success' })
      localOverridden.value = false
      resetDraft()
    }
    else {
      toast.add({ title: 'Workflow deleted', color: 'success' })
      await navigateTo('/workflows')
    }
  }
  catch (e) {
    toast.add({ title: 'Failed to delete', description: errMsg(e), color: 'error' })
  }
  finally {
    removing.value = false
  }
}

// ── inline test run ───────────────────────────────────────────────────────
interface RunRow {
  id: number
  projectId: number
  status: RunStatus
  log: string
  startedAt: string | number | null
  finishedAt: string | number | null
}

const open = ref(false)
const project = ref()
const starting = ref(false)
const activeRun = ref<RunRow | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

async function start() {
  if (!project.value || !saved.value) return
  starting.value = true
  try {
    activeRun.value = await $fetch<RunRow>('/api/runs', {
      method: 'POST',
      body: { projectId: project.value.id, workflow: saved.value.name },
    })
    open.value = false
    selected.value = null
    poll()
  }
  catch (e) {
    toast.add({ title: 'Failed to start test', description: errMsg(e), color: 'error' })
  }
  finally {
    starting.value = false
  }
}

function poll() {
  clearInterval(timer)
  timer = setInterval(async () => {
    if (!activeRun.value) return clearInterval(timer)
    activeRun.value = await $fetch<RunRow>(`/api/runs/${activeRun.value.id}`)
    if (activeRun.value.status === 'success' || activeRun.value.status === 'failed') clearInterval(timer)
  }, 1500)
}

function detach() {
  activeRun.value = null
  clearInterval(timer)
}

async function retest() {
  if (!activeRun.value || !saved.value) return
  const projectId = activeRun.value.projectId
  detach()
  try {
    activeRun.value = await $fetch<RunRow>('/api/runs', {
      method: 'POST',
      body: { projectId, workflow: saved.value.name },
    })
    poll()
  }
  catch { /* surfaced via the run page if it fails to start */ }
}

onUnmounted(() => clearInterval(timer))

// Flush a pending edit (PATCH only — no navigation) when leaving the page.
onUnmounted(() => {
  clearTimeout(saveTimer)
  if (saved.value && valid.value && JSON.stringify(draft.value) !== original.value) {
    $fetch(`/api/workflows/${encodeURIComponent(saved.value.name)}`, { method: 'PATCH', body: saveBody() }).catch(() => {})
  }
})

// Collapse the open step when clicking anywhere outside a step card (clicks on
// the add/library buttons are exempt — they add + select a step).
function onDocClick(e: MouseEvent) {
  if (selected.value === null) return
  const t = e.target as HTMLElement
  if (t.closest('[data-step-card]') || t.closest('[data-keep-open]')) return
  selected.value = null
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

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

// Count the workflow-step markers the runner has written so far (it logs one
// `▶ <type>…` line per step, in order). Excludes non-step markers like
// `▶ Preparing isolated checkout` and `▶ import-db`.
function startedCount(log: string): number {
  return (log.match(/^▶ (ddev-start|bash:|create-branch:|create-commit:|create-pr:)/gm) ?? []).length
}

const statuses = computed<StepStatus[]>(() => {
  const run = activeRun.value
  if (!run) return steps.value.map((_, i) => (i === selected.value ? 'selected' : 'idle'))
  const started = startedCount(run.log)
  return steps.value.map((_, i) => {
    if (i < started - 1) return 'done'
    if (i === started - 1) return run.status === 'failed' ? 'error' : run.status === 'success' ? 'done' : 'running'
    return run.status === 'failed' ? 'skipped' : 'pending'
  })
})

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

function fmtDuration(a: RunRow['startedAt'], b: RunRow['finishedAt']): string {
  if (!a || !b) return '—'
  const ms = new Date(b).getTime() - new Date(a).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const logTail = computed(() => (activeRun.value?.log ?? '').trimEnd().split('\n').slice(-14).join('\n'))

// Literal placeholder/hint text containing `{{ … }}` — kept in script so the Vue
// template compiler doesn't try to interpolate it.
const BRANCH_PLACEHOLDER = 'knecht/{{ run.id }}'
const VAR_HINT = '{{ run.id }}, {{ project.name }}'
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
            <input
              v-if="editable"
              v-model="draft.name"
              placeholder="workflow-name"
              spellcheck="false"
              class="k-mono w-full bg-transparent text-xl font-semibold tracking-[-0.02em] text-(--text-highlighted) outline-none placeholder:text-(--text-dimmed)"
            >
            <h1
              v-else
              class="text-xl font-semibold tracking-[-0.02em] text-(--text-highlighted)"
            >
              {{ saved?.name }}
            </h1>
            <div class="mt-1.5 flex items-center gap-1.5">
              <UBadge
                v-if="mode === 'draft'"
                color="neutral"
                variant="subtle"
                size="sm"
                label="Draft"
              />
              <UBadge
                v-else-if="mode === 'edit'"
                :color="overridden ? 'warning' : 'neutral'"
                variant="subtle"
                size="sm"
                :label="overridden ? 'Customized' : saved?.builtin ? 'Built-in' : 'Saved'"
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
                v-else
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
              @click="navigateTo(`/runs/${activeRun!.id}`)"
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
              @click="navigateTo(`/runs/${activeRun!.id}`)"
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

            <UButton
              v-if="overridden"
              color="neutral"
              variant="ghost"
              icon="i-lucide-rotate-ccw"
              label="Reset to default"
              :loading="removing"
              @click="removeWorkflow"
            />
            <UButton
              v-else-if="saved && !saved.builtin"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              label="Delete"
              :loading="removing"
              @click="removeWorkflow"
            />
            <UTooltip
              :text="!saved ? 'Add a name and a step first' : !valid ? 'Finish the step config first' : !projects?.length ? 'Connect a project first' : ''"
              :disabled="!!saved && valid && !!projects?.length"
            >
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-play"
                label="Start test"
                :disabled="!saved || !valid || saveStatus === 'saving' || !projects?.length"
                @click="open = true"
              />
            </UTooltip>
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
            Test run in the real project · <b>Step {{ Math.max(1, startedCount(activeRun!.log)) }} of {{ steps.length }}</b> · executing…
          </div>
        </div>
        <div class="h-[3px] bg-(--surface-accented)">
          <div
            class="h-full bg-(--accent-orange)"
            :style="{ width: `${(startedCount(activeRun!.log) / steps.length) * 100}%`, boxShadow: '0 0 12px var(--accent-orange)' }"
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
          <b>Test failed at step {{ startedCount(activeRun!.log) }}.</b> The following steps were skipped.
        </div>
      </div>

      <!-- Two columns: step rail + library -->
      <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_312px]">
        <div>
          <!-- Trigger chip -->
          <div class="mb-3 flex gap-3.5">
            <div class="flex w-[30px] flex-none justify-center">
              <UIcon
                name="i-lucide-zap"
                class="mt-[5px] size-[18px] text-(--accent-violet)"
              />
            </div>
            <div
              class="flex flex-1 items-center gap-3 rounded-(--radius-lg) border border-(--border-default) px-[15px] py-3"
              style="background: linear-gradient(90deg, color-mix(in oklab, var(--accent-violet) 8%, var(--surface-muted)), var(--surface-muted))"
            >
              <KStepIcon
                icon="i-lucide-zap"
                color="var(--accent-violet)"
                :size="34"
                :radius="8"
              />
              <div class="flex-1">
                <span class="k-mono text-[10px] uppercase tracking-[0.1em] text-(--accent-violet)">Trigger</span>
                <div class="mt-0.5 text-[13.5px] text-(--text-highlighted)">
                  Manual
                </div>
              </div>
              <span class="k-mono text-[11px] text-(--text-dimmed)">started from the dashboard</span>
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
            <div class="flex flex-1 flex-col items-center gap-4 rounded-(--radius-lg) border border-dashed border-(--border-accented) bg-(--surface-glass) px-6 py-9 text-center">
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
                data-keep-open
                @click="addStep('ddev-start')"
              />
            </div>
          </div>

          <!-- Step rail -->
          <div
            v-for="(r, i) in railSteps"
            v-else
            :key="i"
            class="flex gap-3.5"
            :style="{ opacity: TREAT[r.status].dim ? 0.55 : 1 }"
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

            <div
              data-step-card
              class="relative mb-3 min-w-0 flex-1 overflow-hidden rounded-(--radius-lg)"
              :style="{ border: `1px solid ${TREAT[r.status].border}`, background: TREAT[r.status].bg, boxShadow: 'var(--shadow-panel)' }"
            >
              <span
                v-if="TREAT[r.status].accent"
                class="absolute inset-y-0 left-0 z-10 w-[3px]"
                :style="{ background: TREAT[r.status].accent! }"
              />
              <div class="flex items-center gap-3 pl-[15px] pr-3">
                <button
                  type="button"
                  class="flex-none"
                  :aria-label="selected === i ? 'Collapse step' : 'Expand step'"
                  @click="selected = selected === i ? null : i"
                >
                  <KStepIcon
                    :icon="r.meta.icon"
                    :color="STEP_KIND_COLOR[r.meta.kind]"
                    :size="34"
                    :radius="8"
                  />
                </button>
                <div class="min-w-0 flex-1 py-[11px]">
                  <!-- label + description are editable inline, but only while the
                       step is open — otherwise clicking the row just toggles it. -->
                  <template v-if="editable && selected === i">
                    <input
                      :value="r.meta.label"
                      spellcheck="false"
                      class="w-full bg-transparent text-sm font-medium text-(--text-highlighted) outline-none"
                      @input="setStepLabel(r.step, $event)"
                    >
                    <input
                      :value="r.meta.detail"
                      spellcheck="false"
                      placeholder="Add a description"
                      class="mt-[2px] w-full bg-transparent text-xs text-(--text-muted) outline-none placeholder:text-(--text-dimmed)"
                      @input="setStepDescription(r.step, $event)"
                    >
                  </template>
                  <button
                    v-else
                    type="button"
                    class="block w-full text-left"
                    @click="selected = selected === i ? null : i"
                  >
                    <span class="whitespace-nowrap text-sm font-medium text-(--text-highlighted)">{{ r.meta.label }}</span>
                    <div
                      class="mt-[3px] truncate text-xs"
                      :style="{ color: r.status === 'error' ? 'var(--status-error)' : 'var(--text-muted)' }"
                    >
                      {{ r.meta.detail || 'Not configured yet' }}
                    </div>
                  </button>
                </div>

                <!-- edit controls (hidden during a run) -->
                <div
                  v-if="editable"
                  class="flex flex-none items-center"
                >
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-chevron-up"
                    aria-label="Move up"
                    :disabled="i === 0"
                    @click="moveStep(i, -1)"
                  />
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-chevron-down"
                    aria-label="Move down"
                    :disabled="i === railSteps.length - 1"
                    @click="moveStep(i, 1)"
                  />
                  <UButton
                    color="error"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-trash-2"
                    aria-label="Remove step"
                    @click="removeStep(i)"
                  />
                </div>
                <span
                  v-else-if="STATUS_LABEL[r.status]"
                  class="k-mono flex-none text-[10.5px] uppercase tracking-[0.08em]"
                  :style="{ color: STATUS_LABEL[r.status]!.color }"
                >{{ STATUS_LABEL[r.status]!.text }}</span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-[16px] flex-none cursor-pointer text-(--text-dimmed) transition-transform duration-300"
                  :class="{ 'rotate-180': selected === i }"
                  @click="selected = selected === i ? null : i"
                />
              </div>

              <!-- inline settings — editable, animated open/closed -->
              <div
                class="grid transition-[grid-template-rows] duration-300 ease-out"
                :style="{ gridTemplateRows: selected === i ? '1fr' : '0fr' }"
              >
                <div class="overflow-hidden">
                  <div class="flex flex-col gap-3.5 border-t border-(--border-muted) px-[15px] py-3.5">
                    <template v-if="r.step.type === 'bash'">
                      <div>
                        <span class="k-label">Command</span>
                        <UTextarea
                          v-model="r.step.command"
                          :rows="2"
                          autoresize
                          spellcheck="false"
                          :disabled="!editable"
                          placeholder="ddev composer install"
                          class="mt-1.5 w-full"
                          :ui="{ base: 'k-mono text-[12.5px] resize-none' }"
                        />
                      </div>
                      <USwitch
                        v-model="r.step.continueOnError"
                        :disabled="!editable"
                        label="Continue on error"
                      />
                    </template>
                    <div v-else-if="r.step.type === 'create-branch'">
                      <span class="k-label">Branch name</span>
                      <UInput
                        v-model="r.step.name"
                        :disabled="!editable"
                        :placeholder="BRANCH_PLACEHOLDER"
                        class="mt-1.5 w-full"
                        :ui="{ base: 'k-mono' }"
                      />
                    </div>
                    <div v-else-if="r.step.type === 'create-commit'">
                      <span class="k-label">Commit message</span>
                      <UInput
                        v-model="r.step.message"
                        :disabled="!editable"
                        placeholder="Automated change"
                        class="mt-1.5 w-full"
                      />
                    </div>
                    <template v-else-if="r.step.type === 'create-pr'">
                      <div>
                        <span class="k-label">Title</span>
                        <UInput
                          v-model="r.step.title"
                          :disabled="!editable"
                          placeholder="Knecht change"
                          class="mt-1.5 w-full"
                        />
                      </div>
                      <div>
                        <span class="k-label">Description</span>
                        <UTextarea
                          v-model="r.step.body"
                          :rows="3"
                          autoresize
                          :disabled="!editable"
                          class="mt-1.5 w-full"
                          :ui="{ base: 'text-[12.5px] resize-none' }"
                        />
                      </div>
                    </template>
                    <p
                      v-else
                      class="text-[12.5px] text-(--text-muted)"
                    >
                      This step has no options — edit its name and description above.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Add-step affordance under the rail -->
          <div
            v-if="editable && steps.length"
            class="flex gap-3.5"
          >
            <div class="w-[30px] flex-none" />
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-plus"
              label="Add step"
              class="w-full justify-center"
              data-keep-open
              @click="addStep('bash')"
            />
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
                  <span class="k-mono text-[11.5px] text-(--status-error)">{{ startedCount(activeRun.log) }} of {{ steps.length }}</span>
                </div>
                <pre class="k-mono max-h-[340px] overflow-auto whitespace-pre-wrap rounded-(--radius-md) border border-(--border-muted) bg-(--surface-base) p-3 text-[11.5px] leading-[1.7] text-(--text-muted)">{{ logTail || '—' }}</pre>
              </div>
            </KPanel>
          </div>
        </div>

        <!-- Right column: the step library -->
        <div class="lg:sticky lg:top-0">
          <KPanel
            title="Step library"
            icon="i-lucide-plus"
          >
            <div class="flex flex-col gap-4">
              <div
                v-for="g in LIBRARY"
                :key="g.group"
              >
                <div class="mb-2.5 flex items-center gap-1.5">
                  <KStatusDot
                    :color="LIB_DOT[g.kind]"
                    :size="5"
                  />
                  <span class="k-mono text-[10.5px] uppercase tracking-[0.08em] text-(--text-dimmed)">{{ g.group }}</span>
                </div>
                <div class="flex flex-col gap-1.5">
                  <button
                    v-for="it in g.items"
                    :key="it.type"
                    type="button"
                    :disabled="!editable"
                    data-keep-open
                    class="flex items-center gap-2.5 rounded-(--radius-md) border border-(--border-default) bg-(--surface-base) px-3 py-2.5 text-left transition-colors hover:bg-(--surface-glass) disabled:cursor-not-allowed disabled:opacity-50"
                    @click="addStep(it.type as WorkflowStep['type'])"
                  >
                    <KStepIcon
                      :icon="it.icon"
                      :color="STEP_KIND_COLOR[g.kind]"
                      :size="26"
                      :radius="6"
                    />
                    <span class="text-[12.5px] text-(--text-toned)">{{ it.label }}</span>
                    <UIcon
                      name="i-lucide-plus"
                      class="ml-auto size-[14px] text-(--text-dimmed)"
                    />
                  </button>
                </div>
              </div>
              <p class="k-mono px-1 text-[11px] leading-[1.5] text-(--text-dimmed)">
                Use <span class="text-(--text-muted)">{{ VAR_HINT }}</span> etc. in step fields — they're filled in at run time.
              </p>
            </div>
          </KPanel>
        </div>
      </div>
    </template>

    <!-- Start-test modal -->
    <UModal
      v-model:open="open"
      title="Start test"
      description="Pick a project to run this workflow against."
    >
      <template #body>
        <div class="space-y-4">
          <USelectMenu
            v-model="project"
            :items="projects ?? []"
            placeholder="Select a project…"
            icon="i-lucide-folder-git-2"
            class="w-full"
          />
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="open = false"
            />
            <UButton
              color="primary"
              icon="i-lucide-play"
              label="Start test"
              :loading="starting"
              :disabled="!project"
              @click="start"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
