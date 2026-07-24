<script setup lang="ts">
const route = useRoute()
const toast = useToast()
const toastError = useToastError()
const id = Number(route.params.id)

// Only the project itself blocks rendering; everything else streams in lazily
// (and the runs poll stays scoped to this project instead of the global list).
const { data: project } = await useFetch(`/api/projects/${id}`)
const { data: runs, refresh: refreshRuns } = useFetch('/api/runs', {
  query: { projectId: id },
  default: () => [],
  lazy: true,
})

const fw = computed(() => frameworkMeta(project.value?.framework))
const fwLabel = computed(() =>
  project.value?.frameworkVersion ? `${fw.value.label} ${project.value.frameworkVersion}` : fw.value.label)
const repoName = computed(() => project.value?.fullName.split('/').pop() ?? 'Project')

// This project's runs, newest first (the list is already ordered); the first is
// the latest and drives the preview + status. Per-run logs live on the run page.
const projectRuns = computed(() => runs.value ?? [])
const latest = computed(() => projectRuns.value[0] ?? null)

const isLive = computed(() => isLiveStatus(latest.value?.status))

const statusMeta = computed(() =>
  latest.value ? RUN_STATUS_META[latest.value.status] : IDLE_STATUS_META)

const mascotLine = computed(() => {
  const r = latest.value
  if (!r) return 'No runs yet. Start a workflow to boot this project.'
  if (r.status === 'running' || r.status === 'queued') return `Working on ${r.workflow} right now.`
  if (r.status === 'failed') return 'The last run failed. Open it to see why.'
  if (r.envState === 'up') return 'The preview is live and ready to inspect.'
  return 'Idle. Trigger a workflow to boot a fresh environment.'
})

// Preview lives on its own per-run origin so the app's absolute asset paths
// resolve and the session cookie is shared (see runs/[id]).
const reqUrl = useRequestURL()
const previewUrl = computed(() =>
  latest.value ? `${reqUrl.protocol}//${previewHostname(latest.value.id, reqUrl.host)}/` : '')
// Browsable only once the boot step finished (previewReady), not the moment
// the containers run.
const previewOnline = computed(() =>
  latest.value?.envState === 'up' && latest.value.previewReady)

// ── Start a workflow (picked from the list, right at the project) ──────────
const { data: workflowList } = useFetch('/api/workflows', { default: () => [], lazy: true })
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

async function startWorkflow(workflow: string) {
  startOpen.value = false
  starting.value = true
  try {
    const created = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: id, workflow, branch: selectedBranch.value },
    })
    await navigateTo(`/runs/${created.id}`)
  }
  catch (e) {
    starting.value = false
    toastError('Failed to start run', e)
  }
}

// ── Environment spec (read-only, resolved from the repo's .ddev config) ────
const envSpec = computed(() => {
  const e = project.value?.ddevEnv
  if (!e) return []
  return [
    { label: 'Web', value: e.webserver?.replace(/-fpm$/, '') ?? null },
    { label: 'PHP', value: e.phpVersion },
    { label: 'Database', value: e.dbType ? `${e.dbType}${e.dbVersion ? ` ${e.dbVersion}` : ''}` : null },
    { label: 'Node', value: e.nodeVersion },
    { label: 'Package manager', value: e.packageManager?.replace('@', ' ') ?? null },
  ].filter(r => r.value)
})

// ── Env variables (.env textarea, auto-saved) ──────────────────────────────
// Edited as raw `KEY=value` lines (parseEnvText / envVarsToText helpers); parsed
// and persisted (debounced) on change, so there's no save button.
const envText = ref(envVarsToText(project.value?.envVars ?? []))
const envSaveState = ref<'idle' | 'saving' | 'saved'>('idle')

// Compact preview (first 4) on the panel; the full editor lives in a modal.
const envModalOpen = ref(false)
const envList = computed(() => parseEnvText(envText.value))
const envPreview = computed(() => envList.value.slice(0, 3))

async function persistEnv() {
  envSaveState.value = 'saving'
  try {
    await $fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      body: { envVars: parseEnvText(envText.value) },
    })
    envSaveState.value = 'saved'
  }
  catch (e) {
    envSaveState.value = 'idle'
    toastError('Failed to save', e)
  }
}

let envSaveTimer: ReturnType<typeof setTimeout> | undefined
watch(envText, () => {
  envSaveState.value = 'saving'
  clearTimeout(envSaveTimer)
  envSaveTimer = setTimeout(persistEnv, 700)
})
onUnmounted(() => {
  // Flush a pending edit if the user navigates away mid-debounce.
  if (envSaveTimer) {
    clearTimeout(envSaveTimer)
    persistEnv()
  }
})

// ── Preview URL mode ───────────────────────────────────────────────────────
// 'env' (default): the project derives all URLs from env vars; Knecht points
// them at the preview origins and serves responses untouched. 'rewrite':
// compatibility for projects with hard-coded/DB-stored absolute URLs; the
// proxy rewrites every response. Applies to NEW runs; existing runs keep the
// mode they booted with.
const urlMode = ref<'env' | 'rewrite'>(project.value?.urlMode ?? 'env')
// Collapsed by default inside the env modal: the default mode is right for
// strictly env-based projects, so ideally nobody ever opens this.
const urlModeAdvancedOpen = ref(false)
const urlModeOptions = [
  {
    value: 'env' as const,
    title: 'All base URLs come from the env',
    description: 'The site builds every URL from its env variables. Previews are fastest and most accurate.',
  },
  {
    value: 'rewrite' as const,
    title: 'Base URLs are stored in the database',
    description: 'Absolute URLs live in content, config or templates (e.g. WordPress, imported dumps). Knecht rewrites every response so links keep working.',
  },
]
async function setUrlMode(mode: 'env' | 'rewrite') {
  if (urlMode.value === mode) return
  const previous = urlMode.value
  urlMode.value = mode
  try {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body: { urlMode: mode } })
  }
  catch (e) {
    urlMode.value = previous
    toastError('Failed to save', e)
  }
}

// Database dump upload (shared with the setup wizard via useProjectDump).
const dumpInput = ref<HTMLInputElement>()
const { uploading: uploadingDump, dumpName, upload: uploadDump, remove: removeDump } = useProjectDump(project)

// ── Persistent folders ─────────────────────────────────────────────────────
// Project-relative folders whose files persist across ALL runs and previews
// (one shared host dir each, bind-mounted writable): the place for git-ignored
// CMS uploads. Optionally seeded from a zip; removing a folder here stops the
// mounting but keeps the data (re-adding the path brings the files back).
const sharedFolders = computed(() => project.value?.sharedFolders ?? [])
const newFolder = ref('')
const savingFolders = ref(false)

async function saveFolders(folders: string[]) {
  savingFolders.value = true
  try {
    project.value = await $fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      body: { sharedFolders: folders },
    }) as typeof project.value
  }
  catch (e) {
    toastError('Failed to save', e)
  }
  finally {
    savingFolders.value = false
  }
}

async function addFolder() {
  const path = newFolder.value.trim()
  if (!path) return
  await saveFolders([...sharedFolders.value, path])
  newFolder.value = ''
}

// Seed a folder from a zip: the hidden input is shared, `seedTarget` remembers
// which folder's upload button opened it.
const seedInput = ref<HTMLInputElement>()
const seedTarget = ref('')
const seeding = ref(false)

function pickSeed(path: string) {
  seedTarget.value = path
  seedInput.value?.click()
}

async function uploadSeed(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !seedTarget.value) return
  seeding.value = true
  try {
    const form = new FormData()
    form.append('path', seedTarget.value)
    form.append('file', file)
    const { files } = await $fetch<{ files: number }>(`/api/projects/${id}/shared`, { method: 'POST', body: form })
    toast.add({ title: `${files} file${files === 1 ? '' : 's'} added to ${seedTarget.value}`, color: 'success' })
  }
  catch (e) {
    toastError('Upload failed', e)
  }
  finally {
    seeding.value = false
    input.value = ''
  }
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
const removing = ref(false)
async function removeProject() {
  removing.value = true
  try {
    await $fetch(`/api/projects/${id}`, { method: 'DELETE' })
    toast.add({ title: 'Project disconnected', color: 'success' })
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
const workflowRows = computed(() => (workflowList.value ?? []).map((w) => {
  const wired = projectTriggers.value.filter(t => t.workflow === w.name)
  return { name: w.name, trigger: wired[0] ?? null, more: wired.length - 1 }
}))

// Poll the runs while the latest is still live (updates status + preview state).
usePollWhile(() => isLive.value, refreshRuns)
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

    <div class="mb-5.5 flex flex-wrap items-start justify-between gap-4">
      <div class="flex gap-3.5">
        <KStepIcon
          icon="i-lucide-box"
          :color="fw.color"
          :size="46"
          :radius="10"
        />
        <div>
          <h1 class="k-mono text-2xl font-semibold tracking-tight text-highlighted">
            {{ repoName }}
          </h1>
          <div class="mt-2 flex flex-wrap items-center gap-3.5">
            <span
              class="k-mono inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs tracking-wider"
              :style="{ color: fw.color, borderColor: 'color-mix(in oklab, currentColor 35%, transparent)' }"
            >{{ fwLabel }}</span>
            <span class="flex items-center gap-1.5 text-dimmed">
              <UIcon
                name="i-simple-icons-github"
                class="size-3.5"
              />
              <span class="k-mono text-xs text-muted">{{ project.fullName.split('/')[0] }}</span>
            </span>
            <UBadge
              :color="project.private ? 'neutral' : 'primary'"
              variant="subtle"
              size="sm"
            >
              {{ project.private ? 'Private' : 'Public' }}
            </UBadge>
          </div>
        </div>
      </div>
      <div class="flex flex-none items-center gap-2.5">
        <UButton
          v-if="previewOnline"
          :to="previewUrl"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-lucide-external-link"
          label="Open preview"
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
                v-if="workflowList?.length"
                class="flex flex-col gap-0.5"
              >
                <button
                  v-for="w in workflowList"
                  :key="w.name"
                  type="button"
                  class="flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-(--surface-glass) disabled:cursor-default"
                  :disabled="starting"
                  @click="startWorkflow(w.name)"
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
      </div>
    </div>

    <!-- Sidebar column: identical on every detail page, viewport-based
         (clamp), so it can't drift between screens. Keep in sync with
         workflows/[name].vue. -->
    <div class="grid grid-cols-1 items-start gap-4.5 lg:grid-cols-[1fr_clamp(340px,26vw,560px)]">
      <!-- LEFT -->
      <div class="flex flex-col gap-4.5">
        <KPreviewBrowser
          :key="latest?.id ?? 0"
          :run-id="latest?.id ?? 0"
          :hosts="latest?.previewHosts ?? []"
          :online="previewOnline"
          :booting="isLive"
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

        <KPanel
          title="Runs"
          icon="i-lucide-play"
          :pad="0"
        >
          <template #action>
            <span class="k-mono text-2xs text-dimmed">{{ projectRuns.length }} {{ projectRuns.length === 1 ? 'run' : 'runs' }}</span>
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
          <NuxtLink
            v-for="(r, i) in projectRuns"
            :key="r.id"
            :to="`/runs/${r.id}`"
            class="flex items-center gap-3 px-4.5 py-3 transition-colors hover:bg-(--surface-glass)"
            :class="i ? 'border-t border-muted' : ''"
          >
            <KStatusDot
              :color="RUN_STATUS_META[r.status].dot"
              :pulse="RUN_STATUS_META[r.status].pulse"
              :size="6"
            />
            <span class="k-mono text-xs text-default">{{ r.workflow }}</span>
            <span class="k-mono text-2xs text-dimmed">#{{ r.id }}</span>
            <span
              class="k-mono ml-auto text-2xs"
              :style="{ color: RUN_STATUS_META[r.status].text }"
            >{{ RUN_STATUS_META[r.status].label }}</span>
            <span class="k-mono w-14 text-right text-2xs text-dimmed">{{ runDuration(r.startedAt, r.finishedAt) }}</span>
            <span class="k-mono hidden text-2xs text-dimmed sm:block">{{ timeAgo(r.createdAt) }}</span>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 text-dimmed"
            />
          </NuxtLink>
        </KPanel>
      </div>

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
          title="Environment · DDEV"
          icon="i-lucide-database"
          accent="var(--text-primary)"
        >
          <template #action>
            <span
              v-if="envSaveState !== 'idle'"
              class="k-mono flex items-center gap-1.5 text-2xs text-dimmed"
            >
              <UIcon
                :name="envSaveState === 'saving' ? 'i-lucide-loader-circle' : 'i-lucide-check'"
                class="size-3.5"
                :class="envSaveState === 'saving' ? 'animate-spin' : 'text-primary'"
              />
              {{ envSaveState === 'saving' ? 'Saving…' : 'Saved' }}
            </span>
          </template>

          <div class="flex flex-col gap-4">
            <div class="border-b border-muted pb-3.5">
              <dl
                v-if="envSpec.length"
                class="flex flex-col gap-2"
              >
                <div
                  v-for="row in envSpec"
                  :key="row.label"
                  class="flex items-center justify-between gap-3"
                >
                  <dt class="k-mono text-2xs text-dimmed">
                    {{ row.label }}
                  </dt>
                  <dd class="k-mono text-xs text-toned">
                    {{ row.value }}
                  </dd>
                </div>
              </dl>
              <p
                v-else
                class="k-mono mt-2.5 text-2xs text-dimmed"
              >
                Resolving environment…
              </p>
            </div>

            <button
              type="button"
              class="group block w-full text-left"
              :aria-label="envList.length ? 'Edit env variables' : 'Add env variables'"
              @click="envModalOpen = true"
            >
              <div class="mb-2.5 flex items-center justify-between">
                <span class="k-label">Env variables</span>
                <UIcon
                  name="i-lucide-pencil"
                  class="size-3.5 text-dimmed transition-colors group-hover:text-muted"
                />
              </div>

              <div
                v-if="envPreview.length"
                class="flex flex-col gap-2"
              >
                <div
                  v-for="row in envPreview"
                  :key="row.key"
                  class="flex items-center justify-between gap-3"
                >
                  <span class="k-mono truncate text-xs text-muted transition-colors group-hover:text-toned">{{ row.key }}</span>
                  <span class="k-mono select-none text-xs tracking-[0.2em] text-dimmed">••••••••</span>
                </div>
              </div>
              <span
                v-else
                class="k-mono flex items-center gap-1.5 text-2xs text-dimmed group-hover:text-muted"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-3.5"
                />
                Add variables
              </span>
            </button>

            <div class="flex flex-col items-start border-t border-muted pt-3.5">
              <span class="k-label">Database dump</span>
              <div
                v-if="dumpName"
                class="group mt-2.5 flex w-full items-center gap-2"
              >
                <UIcon
                  name="i-lucide-database"
                  class="size-4 flex-none text-dimmed"
                />
                <span class="k-mono flex-1 truncate text-2xs text-muted">{{ dumpName }}</span>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  aria-label="Remove dump"
                  class="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  @click="removeDump"
                />
              </div>
              <input
                ref="dumpInput"
                type="file"
                class="hidden"
                accept=".sql,.gz,.sql.gz,.zip,.bz2,.xz,.tar,.mysql"
                @change="uploadDump"
              >
              <UButton
                class="mt-2.5"
                :label="dumpName ? 'Replace dump' : 'Upload dump'"
                icon="i-lucide-upload"
                variant="subtle"
                color="neutral"
                size="sm"
                :loading="uploadingDump"
                @click="dumpInput?.click()"
              />
            </div>

            <div class="flex flex-col border-t border-muted pt-3.5">
              <span class="k-label">Persistent folders</span>
              <p class="mt-1.5 text-2xs leading-relaxed text-dimmed">
                Folders that keep their files across all runs and previews, like a CMS uploads folder that is not in git.
              </p>
              <div
                v-for="folder in sharedFolders"
                :key="folder"
                class="group mt-2.5 flex w-full items-center gap-2"
              >
                <UIcon
                  name="i-lucide-folder-sync"
                  class="size-4 flex-none text-dimmed"
                />
                <span class="k-mono flex-1 truncate text-2xs text-muted">{{ folder }}</span>
                <UTooltip text="Fill this folder from a zip">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-upload"
                    :aria-label="`Fill ${folder} from a zip`"
                    :loading="seeding && seedTarget === folder"
                    class="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    @click="pickSeed(folder)"
                  />
                </UTooltip>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :aria-label="`Stop persisting ${folder}`"
                  class="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  @click="saveFolders(sharedFolders.filter(f => f !== folder))"
                />
              </div>
              <input
                ref="seedInput"
                type="file"
                class="hidden"
                accept=".zip"
                @change="uploadSeed"
              >
              <form
                class="mt-2.5 flex items-center gap-2"
                @submit.prevent="addFolder"
              >
                <UInput
                  v-model="newFolder"
                  placeholder="web/uploads"
                  size="sm"
                  class="flex-1"
                  :ui="{ base: 'k-mono text-xs' }"
                />
                <UButton
                  type="submit"
                  label="Add"
                  icon="i-lucide-plus"
                  variant="subtle"
                  color="neutral"
                  size="sm"
                  :loading="savingFolders"
                  :disabled="!newFolder.trim()"
                />
              </form>
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
              :key="row.name"
              class="flex items-center gap-3"
              :style="{ opacity: row.trigger && !row.trigger.active ? 0.55 : 1 }"
            >
              <NuxtLink
                :to="`/workflows/${encodeURIComponent(row.name)}`"
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
                  @click="startWorkflow(row.name)"
                />
              </UTooltip>
            </div>
          </div>
        </KPanel>
      </div>
    </div>

    <UModal
      v-model:open="envModalOpen"
      title="Environment variables"
      description="One KEY=value per line. Paste a .env. Changes are saved automatically."
    >
      <template #body>
        <UTextarea
          v-model="envText"
          :rows="14"
          autoresize
          :maxrows="22"
          spellcheck="false"
          autofocus
          :placeholder="'DATABASE_URL=mysql://db/app\nAPI_KEY=sk-abc123'"
          class="w-full"
          :ui="{ base: 'k-mono text-xs leading-loose resize-none' }"
        />

        <!-- Deliberately tucked away: the default (env) is right for strictly
             env-based projects and should never need touching. The escape
             hatch exists for projects with hard-coded/DB-stored URLs. -->
        <div class="mt-4">
          <button
            type="button"
            class="k-mono flex items-center gap-1.5 text-2xs text-dimmed transition-colors hover:text-muted"
            @click="urlModeAdvancedOpen = !urlModeAdvancedOpen"
          >
            <UIcon
              :name="urlModeAdvancedOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-3.5"
            />
            Advanced: where do the site's base URLs live?
          </button>
          <div
            v-if="urlModeAdvancedOpen"
            class="mt-2.5 flex flex-col gap-2"
          >
            <button
              v-for="option in urlModeOptions"
              :key="option.value"
              type="button"
              class="rounded border p-2.5 text-left transition-colors"
              :class="urlMode === option.value ? 'border-accented' : 'border-muted hover:border-accented/50'"
              :aria-pressed="urlMode === option.value"
              @click="setUrlMode(option.value)"
            >
              <span class="flex items-center gap-2">
                <KStatusDot
                  :color="urlMode === option.value ? 'primary' : 'neutral'"
                  :size="5"
                />
                <span
                  class="k-mono text-xs"
                  :class="urlMode === option.value ? 'text-toned' : 'text-muted'"
                >{{ option.title }}</span>
              </span>
              <span class="k-mono mt-1.5 block text-2xs leading-relaxed text-dimmed">
                {{ option.description }}
              </span>
            </button>
            <p class="k-mono text-2xs text-dimmed">
              Applies to new runs; already-running previews keep the mode they booted with.
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <span
          class="k-mono flex items-center gap-1.5 text-2xs text-dimmed"
        >
          <UIcon
            :name="envSaveState === 'saving' ? 'i-lucide-loader-circle' : 'i-lucide-check'"
            class="size-3.5"
            :class="envSaveState === 'saving' ? 'animate-spin' : 'text-primary'"
          />
          {{ envSaveState === 'saving' ? 'Saving…' : 'Saved' }}
        </span>
      </template>
    </UModal>

    <KConfirmModal
      v-model:open="confirmDisconnect"
      title="Disconnect project"
      :description="`Removes ${project.fullName} from Knecht along with all its runs, environments and checkouts. The GitHub repo itself is not touched.`"
      confirm-label="Disconnect"
      :loading="removing"
      @confirm="removeProject"
    />
  </div>
</template>
