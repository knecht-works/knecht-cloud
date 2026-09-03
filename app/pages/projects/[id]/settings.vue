<script setup lang="ts">
import { AGENT_INSTRUCTIONS_MAX } from '#shared/utils/settings-limits'
import { DDEV_PHP_VERSIONS, ENV_DEFAULTS, NODE_LTS_MAJORS, formatPackageManager, projectDetectedEnv, resolveEnv, sourceLabel } from '#shared/utils/env-spec'

// The project's configuration, split off the workspace page: everything here
// is set up once (env, database dump, persistent folders) and rarely touched
// again, so it lives one step away instead of crowding the run workspace.
const route = useRoute()
const toast = useToast()
const toastError = useToastError()
const id = Number(route.params.id)

const { data: project } = await useFetch(`/api/projects/${id}`)

// ── Environment ────────────────────────────────────────────────────────────
// What the repo resolves to (server/utils/framework.ts, on the default
// branch; each run's log shows the session branch's). A repo with its own
// ddev config is described read-only: that file is the truth. Any other repo
// gets its environment generated from what its files say, and PHP/Node can
// be overridden here when the detection is wrong (empty = detected).
const detectedEnv = computed(() => projectDetectedEnv(project.value?.ddevEnv))
const envSource = computed(() => detectedEnv.value.source)
const ddevSpec = computed(() => {
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

const phpOverride = ref<string | null>(project.value?.phpVersion ?? null)
const nodeOverride = ref<string | null>(project.value?.nodeVersion ?? null)
// The same resolution the boot does, so the card shows exactly what a run
// will get: setting > detected > default.
const resolvedEnv = computed(() => resolveEnv(detectedEnv.value, {
  phpVersion: phpOverride.value,
  nodeVersion: nodeOverride.value,
  devServer: project.value?.devServer ?? null,
  previewPort: project.value?.previewPort ?? null,
}))
// Each version dropdown leads with the "not overridden" choice, worded by
// what it means: what a repo file said, or the default because none did.
function versionItems(field: 'phpVersion' | 'nodeVersion', versions: readonly string[]) {
  const detected = detectedEnv.value.fields[field]
  const label = detected
    ? `Detected: ${detected.value} (${sourceLabel(detected.source)})`
    : `Default: ${ENV_DEFAULTS[field]}`
  // A detected version outside the list (a mise.toml pin like 22.4) is still
  // shown on its entry; only the overrides are limited to the list.
  return [{ label, value: null as string | null }, ...versions.map(v => ({ label: v, value: v }))]
}
const phpItems = computed(() => versionItems('phpVersion', [...DDEV_PHP_VERSIONS].reverse()))
const nodeItems = computed(() => versionItems('nodeVersion', NODE_LTS_MAJORS))
// The package manager is read-only: the repo's package.json or lockfile is
// the truth, and the boot commands are what call it.
const packageManagerLabel = computed(() => `${formatPackageManager(resolvedEnv.value.packageManager.value)} (${sourceLabel(resolvedEnv.value.packageManager.source)})`)
// Save one field right away, rolling the local value back when the PATCH
// fails.
async function saveField<T>(field: Ref<T>, value: T, body: Record<string, unknown>) {
  if (field.value === value) return
  const previous = field.value
  field.value = value
  try {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body })
  }
  catch (e) {
    field.value = previous
    toastError('Failed to save', e)
  }
}
const setPhpOverride = (value: string | null) => saveField(phpOverride, value, { phpVersion: value })
const setNodeOverride = (value: string | null) => saveField(nodeOverride, value, { nodeVersion: value })

// The dev server: a command that serves the app (run under a login shell
// in the web container) and the port it listens on, which is what
// gives a generated environment a preview at all. Saved together: the server
// rejects a command without a port.
const devServer = ref(project.value?.devServer ?? '')
const previewPort = ref(project.value?.previewPort == null ? '' : String(project.value.previewPort))
const previewPortNumber = computed(() => /^\d+$/.test(previewPort.value.trim()) ? Number(previewPort.value.trim()) : null)
// A port is only stored together with its command: clearing the command
// clears the port too (a stored port alone would still count as a preview).
const devServerBody = computed(() => {
  const command = devServer.value.trim() || null
  return { devServer: command, previewPort: command ? previewPortNumber.value : null }
})
const { state: devState, error: devError, schedule: scheduleDev, invalid: devInvalid } = useAutosave(async () => {
  const body = devServerBody.value
  await $fetch(`/api/projects/${id}`, { method: 'PATCH', body })
  // The watcher compares against the project: keep it at the saved value,
  // or a second edit back to the original would count as unchanged.
  if (project.value) project.value = { ...project.value, ...body }
})
watch([devServer, previewPort], () => {
  const { devServer: command, previewPort: port } = devServerBody.value
  if (command && port === null) return devInvalid('Add the port the dev server listens on')
  if (port !== null && (port < 1 || port > 65535)) return devInvalid('The port must be between 1 and 65535')
  if (command === (project.value?.devServer ?? null) && port === (project.value?.previewPort ?? null)) return
  scheduleDev()
})

// ── Env variables (.env textarea, auto-saved) ──────────────────────────────
// Edited as raw `KEY=value` lines (parseEnvText / envVarsToText helpers); parsed
// and persisted (debounced) on change, so there's no save button.
const envText = ref(envVarsToText(project.value?.envVars ?? []))
const envSaveState = ref<'idle' | 'saving' | 'saved'>('idle')

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

// ── Agent instructions (project layer, auto-saved) ─────────────────────────
// Rules for this project only, layered on top of the instance instructions
// from Settings → Agent.
const agentInstructions = ref(project.value?.agentInstructions ?? '')
const { state: instructionsState, error: instructionsError, schedule: scheduleInstructions } = useAutosave(async () => {
  await $fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    body: { agentInstructions: agentInstructions.value },
  })
})
watch(agentInstructions, () => {
  if (agentInstructions.value === (project.value?.agentInstructions ?? '')) return
  scheduleInstructions()
})

// ── Preview URL mode ───────────────────────────────────────────────────────
// 'env' (default): the project derives all URLs from env vars; Knecht points
// them at the preview origins and serves responses untouched. 'rewrite':
// compatibility for projects with hard-coded/DB-stored absolute URLs; the
// proxy rewrites every response. Applies to NEW runs; existing runs keep the
// mode they booted with.
const urlMode = ref<'env' | 'rewrite'>(project.value?.urlMode ?? 'env')
// Collapsed by default: the default mode is right for strictly env-based
// projects, so ideally nobody ever opens this.
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

// ── Boot commands (project layer, auto-saved) ──────────────────────────────
// How THIS project boots: runs after `ddev start` + DB import on a session's
// first boot, before any workflow-specific ddev-start commands. Lives here so
// one generic workflow can serve projects that boot differently.
const bootCommands = ref(project.value?.bootCommands ?? '')
const { state: bootState, error: bootError, schedule: scheduleBoot } = useAutosave(async () => {
  await $fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    body: { bootCommands: bootCommands.value },
  })
})
watch(bootCommands, () => {
  if (bootCommands.value === (project.value?.bootCommands ?? '')) return
  scheduleBoot()
})

// ── Mentions ───────────────────────────────────────────────────────────────
// @-mentioning Knecht on one of this repo's issues/PRs runs the comment as a
// follow-up. The starter workflow is what boots the environment when the
// mentioned thread has no session yet; only published workflows qualify.
const { data: workflows } = await useFetch('/api/workflows')
const starterItems = computed(() =>
  (workflows.value ?? [])
    .filter(w => w.publishedAt)
    .map(w => ({ label: w.name, value: w.id })),
)
const starterWorkflowId = ref<number | null>(project.value?.starterWorkflowId ?? null)
async function setStarter(value: number | null) {
  starterWorkflowId.value = value
  try {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body: { starterWorkflowId: value } })
  }
  catch (e) {
    toastError('Failed to save', e)
  }
}
const mentionsEnabled = ref(project.value?.mentionsEnabled ?? true)
const mentionsAdvancedOpen = ref(false)
async function toggleMentions() {
  mentionsEnabled.value = !mentionsEnabled.value
  try {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body: { mentionsEnabled: mentionsEnabled.value } })
  }
  catch (e) {
    mentionsEnabled.value = !mentionsEnabled.value
    toastError('Failed to save', e)
  }
}
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
      <NuxtLink
        :to="`/projects/${id}`"
        class="k-mono truncate text-xs transition-colors hover:text-muted"
      >
        {{ project.fullName }}
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <span class="k-mono text-xs text-muted">Settings</span>
    </div>

    <!-- The arrow is the obvious way back to the workspace; the breadcrumb
         above stays as the subtle one (and already names the repo, so the
         title needs no subtitle). Hand-rolled instead of KTopBar: the arrow
         must center against the single title line, not the whole block. -->
    <div class="mb-4.5 flex items-center gap-2">
      <UButton
        :to="`/projects/${id}`"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        aria-label="Back to project"
        class="-ml-2.5"
      />
      <h1 class="text-xl font-semibold leading-tight tracking-tight text-highlighted">
        Project settings
      </h1>
    </div>

    <!-- Same two-column grid as the workspace and the workflow editor
         (sidebar clamp identical on every detail page): the env editor gets
         the wide column; the read-only DDEV facts and the rarer upload
         panels sit in the sidebar. -->
    <div class="grid grid-cols-1 items-start gap-4.5 lg:grid-cols-[1fr_clamp(340px,26vw,560px)]">
      <div class="flex flex-col gap-4.5">
        <KPanel
          title="Env variables"
          icon="i-lucide-key-round"
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

          <div>
            <p class="mb-2.5 text-2xs leading-relaxed text-dimmed">
              One KEY=value per line. Paste a .env. Changes are saved automatically.
            </p>
            <UTextarea
              v-model="envText"
              :rows="10"
              autoresize
              :maxrows="22"
              spellcheck="false"
              :placeholder="'DATABASE_URL=mysql://db/app\nAPI_KEY=sk-abc123'"
              class="w-full"
              :ui="{ base: 'k-mono text-xs leading-loose resize-none' }"
            />

            <!-- Deliberately tucked away: the default (env) is right for strictly
               env-based projects and should never need touching. The escape
               hatch exists for projects with hard-coded/DB-stored URLs. Only
               a repo with its own web server has base URLs to speak of. -->
            <div
              v-if="envSource === 'ddev'"
              class="mt-4"
            >
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
          </div>
        </KPanel>

        <KPanel
          title="Agent instructions"
          icon="i-lucide-list-checks"
          accent="var(--accent-orange)"
        >
          <template #action>
            <KSaveStatus
              v-if="instructionsState !== 'idle'"
              :state="instructionsState"
              :error-text="instructionsError"
            />
          </template>
          <div>
            <p class="mb-2.5 text-2xs leading-relaxed text-dimmed">
              Rules the agent follows in this project only, on top of the
              instance-wide instructions from Settings → Agent. Saved automatically.
            </p>
            <UTextarea
              v-model="agentInstructions"
              :rows="4"
              autoresize
              :maxrows="16"
              :maxlength="AGENT_INSTRUCTIONS_MAX"
              placeholder="Styles live in src/css. Use the existing design tokens, never raw hex values."
              class="w-full"
            />
          </div>
        </KPanel>

        <KPanel
          title="Mentions"
          icon="i-lucide-at-sign"
        >
          <div class="flex flex-col">
            <p class="text-2xs leading-relaxed text-dimmed">
              Write
              <span class="k-mono text-toned">@{{ project.mentionHandle ?? 'knecht' }} &lt;instruction&gt;</span>
              in a comment on one of this repo's issues or pull requests and
              Knecht does what the comment says, then answers in the thread.
            </p>
            <div class="k-label mb-1.5 mt-3">
              Which workflow boots the environment for a new thread?
            </div>
            <USelectMenu
              :model-value="starterItems.find(i => i.value === starterWorkflowId)"
              :items="starterItems"
              placeholder="Choose a starter workflow…"
              icon="i-lucide-rocket"
              class="w-full"
              @update:model-value="(item: { value: number } | undefined) => setStarter(item?.value ?? null)"
            />
            <p
              v-if="!starterWorkflowId"
              class="k-mono mt-1.5 text-2xs text-dimmed"
            >
              Until one is chosen, Knecht answers mentions with a setup hint.
            </p>

            <div class="mt-3.5">
              <button
                type="button"
                class="k-mono flex items-center gap-1.5 text-2xs text-dimmed transition-colors hover:text-muted"
                @click="mentionsAdvancedOpen = !mentionsAdvancedOpen"
              >
                <UIcon
                  :name="mentionsAdvancedOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  class="size-3.5"
                />
                Advanced
              </button>
              <div
                v-if="mentionsAdvancedOpen"
                class="mt-2.5 flex items-center justify-between gap-3"
              >
                <span class="text-2xs text-muted">Answer mentions in this repo</span>
                <KToggle
                  :active="mentionsEnabled"
                  :aria-label="mentionsEnabled ? 'Disable mentions' : 'Enable mentions'"
                  @toggle="toggleMentions"
                />
              </div>
            </div>
          </div>
        </KPanel>
      </div>

      <div class="flex flex-col gap-4.5">
        <KPanel
          title="Environment"
          icon="i-lucide-database"
        >
          <p
            v-if="!project.ddevEnv"
            class="k-mono text-2xs text-dimmed"
          >
            Resolving environment…
          </p>
          <!-- The repo ships its own ddev config: read-only, that file is the truth. -->
          <div
            v-else-if="envSource === 'ddev'"
            class="flex flex-col gap-2"
          >
            <div
              v-for="row in ddevSpec"
              :key="row.label"
              class="flex items-center justify-between gap-3"
            >
              <span class="k-mono text-2xs text-dimmed">{{ row.label }}</span>
              <span class="k-mono text-xs text-toned">{{ row.value }}</span>
            </div>
          </div>
          <!-- No ddev config in the repo: Knecht generates the environment.
               Each row says where its value comes from; PHP and Node can be
               overridden, empty means detected. -->
          <div
            v-else
            class="flex flex-col gap-3"
          >
            <div>
              <div class="k-label mb-1.5">
                PHP
              </div>
              <USelectMenu
                :model-value="phpItems.find(i => i.value === phpOverride)"
                :items="phpItems"
                :search-input="false"
                class="w-full"
                @update:model-value="(item: { value: string | null } | undefined) => setPhpOverride(item?.value ?? null)"
              />
            </div>
            <div>
              <div class="k-label mb-1.5">
                Node
              </div>
              <USelectMenu
                :model-value="nodeItems.find(i => i.value === nodeOverride)"
                :items="nodeItems"
                :search-input="false"
                class="w-full"
                @update:model-value="(item: { value: string | null } | undefined) => setNodeOverride(item?.value ?? null)"
              />
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="k-label">Package manager</span>
              <span class="k-mono text-xs text-toned">{{ packageManagerLabel }}</span>
            </div>
            <div>
              <div class="mb-1.5 flex items-center justify-between gap-3">
                <span class="k-label">Dev server</span>
                <KSaveStatus
                  v-if="devState !== 'idle'"
                  :state="devState"
                  :error-text="devError"
                />
              </div>
              <UInput
                v-model="devServer"
                placeholder="npm run dev"
                size="sm"
                class="w-full"
                :ui="{ base: 'k-mono text-xs' }"
              />
              <UInput
                v-if="devServer.trim()"
                v-model="previewPort"
                placeholder="Port, e.g. 3000"
                inputmode="numeric"
                size="sm"
                class="mt-2 w-full"
                :ui="{ base: 'k-mono text-xs' }"
              />
              <p class="k-mono mt-1.5 text-2xs leading-relaxed text-dimmed">
                Optional. Serves the preview on this port: localhost is fine, and the
                preview URL is available to it as <span class="text-muted">KNECHT_PREVIEW_URL</span>
                (Vite-based dev servers such as Vite and Nuxt allow the preview host by themselves, other servers need it in their allowed hosts).
                Without it the environment has no preview.
              </p>
            </div>
            <p
              v-for="warning in detectedEnv.warnings"
              :key="warning"
              class="k-mono text-2xs"
              style="color: var(--status-warning, var(--accent-orange))"
            >
              {{ warning }}
            </p>
          </div>
        </KPanel>

        <KPanel
          title="Boot commands"
          icon="i-lucide-terminal"
        >
          <template #action>
            <KSaveStatus
              v-if="bootState !== 'idle'"
              :state="bootState"
              :error-text="bootError"
            />
          </template>
          <div>
            <p class="mb-2.5 text-2xs leading-relaxed text-dimmed">
              What has to run after <span class="k-mono">ddev start</span> and the
              database import before the site works. One command per line, run
              once per session, before any workflow-specific boot commands.
            </p>
            <UTextarea
              v-model="bootCommands"
              :rows="3"
              autoresize
              :maxrows="10"
              spellcheck="false"
              placeholder="ddev composer install"
              class="w-full"
              :ui="{ base: 'k-mono text-xs leading-loose resize-none' }"
            />
          </div>
        </KPanel>

        <!-- Only an environment with a database container can import a dump
             (the boot step applies the same rule). -->
        <KPanel
          v-if="resolvedEnv.hasDb.value"
          title="Database dump"
          icon="i-lucide-hard-drive-download"
        >
          <div class="flex flex-col items-start">
            <div
              v-if="dumpName"
              class="group flex w-full items-center gap-2"
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
        </KPanel>

        <KPanel
          title="Persistent folders"
          icon="i-lucide-folder-sync"
        >
          <div class="flex flex-col">
            <p class="text-2xs leading-relaxed text-dimmed">
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
        </KPanel>
      </div>
    </div>
  </div>
</template>
