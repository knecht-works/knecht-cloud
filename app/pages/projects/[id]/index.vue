<script setup lang="ts">
import { stepsInclude, type Step } from '#shared/utils/workflow'

const route = useRoute()
const toast = useToast()
const toastError = useToastError()
const id = Number(route.params.id)

// The workspace: the project's runs with ONE explicitly selected run rendered
// inline (KRunWorkspace: preview, follow-up chat, steps, log). Both fetches
// block rendering; the selection must resolve during setup so a deep link
// (?run=<id>) lands on the right run without a flash of the newest one.
const { data: project } = await useFetch(`/api/projects/${id}`)
const { data: runs, refresh: refreshRuns } = await useFetch('/api/runs', {
  query: { projectId: id },
  default: () => [],
})

const fw = computed(() => frameworkMeta(project.value?.framework))
const fwLabel = computed(() =>
  project.value?.frameworkVersion ? `${fw.value.label} ${project.value.frameworkVersion}` : fw.value.label)
const repoName = computed(() => project.value?.fullName.split('/').pop() ?? 'Project')

// This project's runs, newest first (the list is already ordered).
const projectRuns = computed(() => runs.value ?? [])
const latest = computed(() => projectRuns.value[0] ?? null)

// The sidebar list grouped by session (utils/dashboard.ts): runs on the same
// issue/PR collect under one object header, one-shot runs (manual, push,
// schedule) stay plain rows.
const sessionGroups = computed(() => groupRunsBySession(projectRuns.value))

// ── Run selection (?run=<id>, default: the newest run) ─────────────────────
// The selection is a ref, not a computed from the query, so it NEVER moves
// on its own: a new run appearing (trigger, webhook) changes the list but not
// what the workspace shows. Only user actions write the query, and the query
// watcher below is the only path that moves the selection afterwards.
function runFromQuery(): number | null {
  const q = Number(route.query.run)
  return projectRuns.value.some(r => r.id === q) ? q : null
}

// A ?run older than the runs list's cap (200) is still a valid deep link
// (run URLs sit in PR bodies and Jira comments): resolve it directly instead
// of silently falling back to the newest run. The sidebar list won't contain
// it, but the workspace renders by id.
const offListRun = ref<(typeof projectRuns.value)[number] | null>(null)
const queryRun = Number(route.query.run)
if (Number.isInteger(queryRun) && !projectRuns.value.some(r => r.id === queryRun)) {
  const fetched = await $fetch(`/api/runs/${queryRun}`).catch(() => null)
  if (fetched && fetched.projectId === id) {
    const { log, steps, ...row } = fetched
    offListRun.value = { ...row, hasBootStep: stepsInclude((steps ?? []) as Step[], 'ddev-start') }
  }
}

const selectedRunId = ref<number | null>(runFromQuery() ?? offListRun.value?.id ?? latest.value?.id ?? null)
const selectedRun = computed(() =>
  projectRuns.value.find(r => r.id === selectedRunId.value)
  ?? (offListRun.value?.id === selectedRunId.value ? offListRun.value : null))

// A ?run pointing at another project's run (or a deleted one) fell back to
// the newest above; drop the stale param from the URL (client-side, same
// pattern as the ?step deep link in workflows/[name].vue).
onMounted(() => {
  if (route.query.run && !runFromQuery() && Number(route.query.run) !== offListRun.value?.id)
    navigateTo({ query: { ...route.query, run: undefined } }, { replace: true })
})

watch(() => route.query.run, () => {
  const q = runFromQuery()
  if (q) selectedRunId.value = q
  // Selecting the newest run acknowledges it, clearing the new-run hint.
  if (q !== null && q === latest.value?.id) lastSeenLatestId.value = q
})

// Selection writes always replace: switching runs is a view change, not a
// navigation the back button should walk through.
function selectRun(runId: number) {
  navigateTo({ query: { ...route.query, run: String(runId) } }, { replace: true })
}

// ── New-run hint ───────────────────────────────────────────────────────────
// The newest run id the user has acknowledged: runs started from this page
// acknowledge themselves, so the hint pill only appears when a run arrived
// from elsewhere (trigger, webhook, another tab) while an older run is open.
const lastSeenLatestId = ref(latest.value?.id ?? null)
const newRun = computed(() =>
  latest.value && latest.value.id !== selectedRunId.value && latest.value.id !== lastSeenLatestId.value
    ? latest.value
    : null)

// If the selected run vanished from the list (deleted, here or in another
// tab), fall back to the newest run instead of showing the empty state next
// to a non-empty list. An off-list deep-link selection is exempt: it is
// never in the list.
watch(runs, () => {
  if (selectedRunId.value === offListRun.value?.id) return
  if (selectedRunId.value !== null && !projectRuns.value.some(r => r.id === selectedRunId.value)) {
    selectedRunId.value = latest.value?.id ?? null
    lastSeenLatestId.value = latest.value?.id ?? null
    navigateTo({ query: { ...route.query, run: undefined } }, { replace: true })
  }
})

const statusMeta = computed(() =>
  selectedRun.value ? RUN_STATUS_META[selectedRun.value.status] : IDLE_STATUS_META)

const mascotLine = computed(() => {
  const r = selectedRun.value
  if (!r) return 'No runs yet. Start a workflow to boot this project.'
  if (r.status === 'running' || r.status === 'queued') return `Working on ${r.workflow} right now.`
  if (r.status === 'failed') return 'The last run failed. Open it to see why.'
  if (!r.hasBootStep) return 'This workflow works without a preview environment.'
  if (r.envState === 'up') return r.hasPreviewTarget ? 'The preview is live and ready to inspect.' : 'The environment is up. Open the terminal or the IDE to work in it.'
  return 'Idle. Trigger a workflow to boot a fresh environment.'
})

// ── Start a workflow (picked from the list, right at the project) ──────────
const { data: workflowList } = useFetch('/api/workflows', { default: () => [], lazy: true })
// Manual runs execute the workflow's current state, so the picker offers
// every workflow that would pass the run validation (finish half-built ones
// in the editor first).
const startableWorkflows = computed(() => (workflowList.value ?? []).filter(workflowRunnable))
const starting = ref(false)
// The "Start workflow" popover (branch + workflow picker together).
const startOpen = ref(false)

// Branch the run checks out; defaults to the repo's default branch (main). The
// list is fetched lazily from GitHub; the picker always includes the default.
const selectedBranch = ref(project.value?.defaultBranch ?? 'main')
const { items: branchItems } = useBranchPicker(
  () => `/api/projects/${id}/branches`,
  () => project.value?.defaultBranch ?? 'main',
)

async function startWorkflow(workflowId: number) {
  startOpen.value = false
  starting.value = true
  try {
    const created = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: id, workflowId, branch: selectedBranch.value },
    })
    await onRunStarted(created.id)
  }
  catch (e) {
    toastError('Failed to start run', e)
  }
  finally {
    starting.value = false
  }
}

// A run started from this page (popover, automation play button, or "Run
// again" inside the workspace) is selected right away; no page navigation.
async function onRunStarted(runId: number) {
  await refreshRuns()
  lastSeenLatestId.value = runId
  await navigateTo({ query: { ...route.query, run: String(runId) } }, { replace: true })
}

// The workspace deleted its run; the runs watcher above moves the selection
// to the newest remaining run once the refreshed list lands. A deleted
// off-list run loses its exemption first, so the watcher picks it up.
async function onRunDeleted() {
  if (offListRun.value?.id === selectedRunId.value) offListRun.value = null
  await refreshRuns()
}

// ── Disconnect (delete project + its runs, envs and checkouts) ─────────────
// Destructive, so it lives in the header's overflow menu behind a confirm.
const confirmDisconnect = ref(false)
const menuItems = [{
  label: 'Disconnect project',
  icon: 'i-lucide-trash-2',
  color: 'error' as const,
  onSelect: () => { confirmDisconnect.value = true },
}]
// Runs still executing or waiting: the delete aborts them, so the modal
// says so instead of hiding it in the generic list.
const activeRunCount = computed(() =>
  projectRuns.value.filter(r => r.status === 'running' || r.status === 'queued').length)
const disconnectDescription = computed(() => {
  const active = activeRunCount.value
  const abort = active
    ? ` ${active === 1 ? '1 run is' : `${active} runs are`} still active and will be cancelled.`
    : ''
  return `Removes ${project.value?.fullName} from Knecht: all its runs, sessions and preview environments, uploaded DB dumps, shared folders and agent memory.${abort} The GitHub repo itself is not touched.`
})
const removing = ref(false)
async function removeProject() {
  removing.value = true
  try {
    await $fetch(`/api/projects/${id}`, { method: 'DELETE' })
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

// ── Automation on this project (read-only) ─────────────────────────────────
// Which workflow fires on this project and how: configured on the workflow
// itself, so each row links there. The play button starts a workflow here now.
const { data: triggers } = useFetch('/api/triggers', { default: () => [], lazy: true })
const projectTriggers = computed(() =>
  (triggers.value ?? []).filter(t => t.projectIds.includes(id)))

// One row per workflow: its automation on THIS project (first trigger +
// count of further ones), or none: "welcher Workflow startet wann".
const workflowRows = computed(() => startableWorkflows.value.map((w) => {
  const wired = projectTriggers.value.filter(t => t.workflowId === w.id)
  return { id: w.id, name: w.name, trigger: wired[0] ?? null, more: wired.length - 1 }
}))

// Poll the runs list while ANY of this project's runs is live: the selected
// run is not necessarily the latest, and the sidebar rows + new-run hint
// should stay current either way. The selected run's own detail polling
// lives inside KRunWorkspace.
usePollWhile(() => projectRuns.value.some(r => isLiveStatus(r.status)), refreshRuns)
</script>

<template>
  <div v-if="project">
    <div class="mb-3.5 flex items-center gap-2 text-dimmed">
      <NuxtLink
        to="/projects"
        class="k-mono text-xs transition-colors hover:text-muted"
      >
        Projects
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <span class="k-mono truncate text-xs text-muted">{{ project.fullName }}</span>
    </div>

    <KPageHeader
      class="mb-5.5"
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
        <UButton
          :to="`/projects/${id}/settings`"
          color="neutral"
          variant="outline"
          icon="i-lucide-settings-2"
          label="Settings"
        />
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

    <!-- Sidebar column: identical on every detail page, viewport-based
         (clamp), so it can't drift between screens. Keep in sync with
         workflows/[name].vue. -->
    <div class="grid grid-cols-1 items-start gap-4.5 lg:grid-cols-[1fr_clamp(340px,26vw,560px)]">
      <!-- LEFT: the selected run's workspace, keyed so switching runs
           remounts everything (preview history, fetches, expanded steps). -->
      <KRunWorkspace
        v-if="selectedRun"
        :key="selectedRun.id"
        :run-id="selectedRun.id"
        @deleted="onRunDeleted"
        @started="onRunStarted"
        @changed="refreshRuns"
      />
      <KPreviewBrowser
        v-else
        :session-id="0"
        :online="false"
        :booting="false"
      >
        <img
          src="/mascot/mascotRight.png"
          alt="Knecht"
          class="h-16 w-auto drop-shadow-mascot"
        >
        <p class="max-w-70 text-2sm text-muted">
          No live preview yet. Start a workflow to boot the project, then preview it here.
        </p>
      </KPreviewBrowser>

      <!-- RIGHT -->
      <div class="flex flex-col gap-4.5">
        <div
          class="k-card overflow-hidden"
          style="border-color: var(--primary-border)"
        >
          <div
            class="flex items-center gap-3.5 px-5 py-4.5"
            style="background: linear-gradient(90deg, color-mix(in oklab, var(--primary) 8%, transparent), transparent)"
          >
            <img
              src="/mascot/mascotRight.png"
              alt="Knecht"
              class="h-13 w-auto flex-none drop-shadow-mascot"
            >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <KStatusDot
                  :color="statusMeta.dot"
                  :pulse="statusMeta.pulse"
                  :size="6"
                />
                <span
                  class="k-mono text-2xs uppercase tracking-widest"
                  :style="{ color: statusMeta.text }"
                >{{ statusMeta.label }}</span>
              </div>
              <p class="mt-1.5 text-2sm leading-snug text-toned">
                {{ mascotLine }}
              </p>
            </div>
          </div>
        </div>

        <KPanel
          title="Runs"
          icon="i-lucide-play"
          :pad="0"
        >
          <template #action>
            <button
              v-if="newRun"
              type="button"
              class="k-mono flex cursor-pointer items-center gap-1.5 text-2xs text-primary transition-colors hover:text-highlighted"
              @click="selectRun(newRun.id)"
            >
              <KStatusDot
                color="primary"
                pulse
                :size="5"
              />
              New run #{{ newRun.id }}
            </button>
            <span
              v-else
              class="k-mono text-2xs text-dimmed"
            >{{ projectRuns.length }} {{ projectRuns.length === 1 ? 'run' : 'runs' }}</span>
          </template>

          <div
            v-if="!projectRuns.length"
            class="flex flex-col items-center gap-3 px-5 py-10 text-center"
          >
            <UIcon
              name="i-lucide-play"
              class="size-7 text-dimmed"
            />
            <p class="text-2sm text-muted">
              No runs yet. Start a workflow to boot this project.
            </p>
          </div>
          <!-- Rows SELECT (query replace), they don't navigate: the run
               renders on the left. The selected row is marked with the
               primary edge bar. Runs on the same issue/PR sit under one
               session header (the object's number + title, linking to the
               thread); one-shot runs stay plain rows. Capped in height (the
               API returns up to 200 runs) so a busy project scrolls here
               instead of pushing the Automation panel off screen. -->
          <div class="max-h-100 overflow-y-auto">
            <div
              v-for="(g, gi) in sessionGroups"
              :key="g.sessionId"
              :class="gi ? 'border-t border-muted' : ''"
            >
              <KSessionGroupHeader
                v-if="g.object"
                :object="g.object"
              />
              <NuxtLink
                v-for="r in g.runs"
                :key="r.id"
                :to="{ query: { run: String(r.id) } }"
                replace
                class="relative flex items-center gap-3 py-3 pr-4.5 transition-colors hover:bg-(--surface-glass)"
                :class="[
                  g.object ? 'pl-8' : 'pl-4.5',
                  r.id === selectedRunId ? 'bg-(--surface-glass)' : '',
                ]"
                :aria-current="r.id === selectedRunId ? 'true' : undefined"
              >
                <span
                  v-if="r.id === selectedRunId"
                  class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
                />
                <KStatusDot
                  :color="RUN_STATUS_META[r.status].dot"
                  :pulse="RUN_STATUS_META[r.status].pulse"
                  :size="6"
                />
                <span class="k-mono min-w-0 truncate text-xs text-default">{{ r.workflow }}</span>
                <span class="k-mono shrink-0 text-2xs text-dimmed">#{{ r.id }}</span>
                <span class="k-mono ml-auto w-14 text-right text-2xs text-dimmed">{{ runDuration(r.startedAt, r.finishedAt) }}</span>
                <span class="k-mono hidden w-16 text-right text-2xs text-dimmed sm:block">{{ timeAgo(r.createdAt) }}</span>
              </NuxtLink>
            </div>
          </div>
        </KPanel>

        <KPanel
          title="Automation"
          icon="i-lucide-zap"
          accent="var(--accent-violet)"
        >
          <!-- One row per WORKFLOW: run it now, and see WHEN it fires on this
               project. The row links to the workflow, where its triggers live. -->
          <div class="flex flex-col gap-3">
            <div
              v-for="row in workflowRows"
              :key="row.id"
              class="flex items-center gap-3"
              :style="{ opacity: row.trigger && !row.trigger.active ? 0.55 : 1 }"
            >
              <NuxtLink
                :to="`/workflows/${row.id}`"
                class="group flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <KStepIcon
                  :icon="row.trigger ? triggerSourceMeta(row.trigger.source).icon : 'i-lucide-workflow'"
                  :color="row.trigger ? triggerSourceMeta(row.trigger.source).color : 'var(--text-dimmed)'"
                  :size="28"
                  :radius="7"
                />
                <span class="min-w-0 flex-1">
                  <span class="k-mono block truncate text-xs text-default transition-colors group-hover:text-highlighted">
                    {{ row.name }}
                  </span>
                  <span class="k-mono block truncate text-2xs text-dimmed">
                    <template v-if="row.trigger">
                      {{ row.trigger.event }} · {{ triggerSourceMeta(row.trigger.source).label }}<template v-if="row.more > 0"> · +{{ row.more }}</template>
                    </template>
                    <template v-else>
                      Manual only
                    </template>
                  </span>
                </span>
              </NuxtLink>
              <UTooltip :text="`Run ${row.name} on this project now`">
                <UButton
                  icon="i-lucide-play"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Run ${row.name} now`"
                  :disabled="starting"
                  @click="startWorkflow(row.id)"
                />
              </UTooltip>
            </div>
          </div>
        </KPanel>
      </div>
    </div>

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
