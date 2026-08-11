<script setup lang="ts">
import { AGENT_INSTRUCTIONS_MAX } from '#shared/utils/settings-limits'

// The project's configuration, split off the workspace page: everything here
// is set up once (env, database dump, persistent folders) and rarely touched
// again, so it lives one step away instead of crowding the run workspace.
const route = useRoute()
const toast = useToast()
const toastError = useToastError()
const id = Number(route.params.id)

const { data: project } = await useFetch(`/api/projects/${id}`)

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
      </div>

      <div class="flex flex-col gap-4.5">
        <!-- Read-only: what the repo's .ddev config resolves to. -->
        <KPanel
          title="Environment · DDEV"
          icon="i-lucide-database"
        >
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
            class="k-mono text-2xs text-dimmed"
          >
            Resolving environment…
          </p>
        </KPanel>

        <KPanel
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
