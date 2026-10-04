<script setup lang="ts">
import { DDEV_PHP_VERSIONS, ENV_DEFAULTS, NODE_LTS_MAJORS, PACKAGE_MANAGERS, type EnvSpec, type PackageManagerName, formatPackageManager, projectDetectedEnv, resolveEnv } from '#shared/utils/env-spec'
import { PREVIEW_FORWARD_PORT } from '#shared/utils/preview-host'

const toast = useToast()
const toastError = useToastError()
const id = Number(useRoute().params.id)

const { data: project } = await useFetch(`/api/projects/${id}`)

const fwLabel = computed(() => {
  const label = frameworkMeta(project.value?.framework).label
  return project.value?.frameworkVersion ? `${label} ${project.value.frameworkVersion}` : label
})

const detectedEnv = computed(() => projectDetectedEnv(project.value?.ddevEnv))
const envSource = computed(() => detectedEnv.value.source)
const ddevSpec = computed(() => {
  const e = project.value?.ddevEnv
  if (!e) return []
  return [
    { label: 'Framework', value: fwLabel.value },
    { label: 'Web', value: e.webserver?.replace(/-fpm$/, '') ?? null },
    { label: 'PHP', value: e.phpVersion },
    { label: 'Database', value: e.dbType ? `${e.dbType}${e.dbVersion ? ` ${e.dbVersion}` : ''}` : null },
    { label: 'Node', value: e.nodeVersion },
    { label: 'Package manager', value: resolvedEnv.value.packageManager.source === 'default' ? null : formatPackageManager(resolvedEnv.value.packageManager.value) },
  ].filter(r => r.value)
})

const phpOverride = ref<string | null>(project.value?.phpVersion ?? null)
const nodeOverride = ref<string | null>(project.value?.nodeVersion ?? null)
const packageManagerOverride = ref<PackageManagerName | null>(project.value?.packageManager ?? null)
const envOverrides = computed(() => ({
  phpVersion: phpOverride.value,
  nodeVersion: nodeOverride.value,
  packageManager: packageManagerOverride.value,
}))
function overrideItems<K extends keyof typeof envOverrides.value>(field: K, choices: readonly string[], format: (value: EnvSpec[K]) => string) {
  const detected = detectedEnv.value.fields[field]
  const label = detected
    ? `Detected: ${format(detected.value)}`
    : `Default: ${format(ENV_DEFAULTS[field])}`
  return [{ label, value: null as string | null }, ...choices.map(v => ({ label: v, value: v }))]
}
const phpItems = computed(() => overrideItems('phpVersion', [...DDEV_PHP_VERSIONS].reverse(), String))
const nodeItems = computed(() => overrideItems('nodeVersion', NODE_LTS_MAJORS, String))
const packageManagerItems = computed(() => overrideItems('packageManager', PACKAGE_MANAGERS, formatPackageManager))

const { state: envState, error: envError, schedule: scheduleEnv } = useAutosave(async () => {
  const body = envOverrides.value
  await $fetch(`/api/projects/${id}`, { method: 'PATCH', body })
  // The watcher compares against the project, so keep it at the saved value
  // or a second edit back to the original would count as unchanged.
  if (project.value) project.value = { ...project.value, ...body }
})
watch(envOverrides, (next) => {
  const saved = project.value
  if (saved && (Object.keys(next) as (keyof typeof next)[]).every(key => next[key] === (saved[key] ?? null))) return
  scheduleEnv()
})

const devServer = ref(project.value?.devServer ?? '')
const previewPort = ref(project.value?.previewPort == null ? '' : String(project.value.previewPort))
const previewPortNumber = computed(() => /^\d+$/.test(previewPort.value.trim()) ? Number(previewPort.value.trim()) : null)
const devServerBody = computed(() => {
  const command = devServer.value.trim() || null
  return { devServer: command, previewPort: command ? previewPortNumber.value : null }
})
const { state: devState, error: devError, schedule: scheduleDev, invalid: devInvalid } = useAutosave(async () => {
  const body = devServerBody.value
  await $fetch(`/api/projects/${id}`, { method: 'PATCH', body })
  if (project.value) project.value = { ...project.value, ...body }
})
watch(devServerBody, ({ devServer: command, previewPort: port }) => {
  if (command && port === null) return devInvalid('Add the port the dev server listens on')
  if (port !== null && (port < 1 || port > 65535)) return devInvalid('The port must be between 1 and 65535')
  if (port === PREVIEW_FORWARD_PORT) return devInvalid(`Port ${PREVIEW_FORWARD_PORT} is reserved for the preview`)
  if (command === (project.value?.devServer ?? null) && port === (project.value?.previewPort ?? null)) return
  scheduleDev()
})

const resolvedEnv = computed(() => resolveEnv(detectedEnv.value, { ...envOverrides.value, ...devServerBody.value }))

const envText = ref(envVarsToText(project.value?.envVars ?? []))
const { state: envVarsState, error: envVarsError, schedule: scheduleEnvVars } = useAutosave(async () => {
  const envVars = parseEnvText(envText.value)
  await $fetch(`/api/projects/${id}`, { method: 'PATCH', body: { envVars } })
  if (project.value) project.value = { ...project.value, envVars }
})
watch(envText, () => {
  if (envText.value === envVarsToText(project.value?.envVars ?? [])) return
  scheduleEnvVars()
})

const urlMode = ref<'env' | 'rewrite'>(project.value?.urlMode ?? 'env')
const urlModeOptions = [
  {
    value: 'env' as const,
    title: 'From env',
    description: 'The site builds every URL from its env variables. Previews are fastest and most accurate.',
  },
  {
    value: 'rewrite' as const,
    title: 'In database',
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

const dumpInput = ref<HTMLInputElement>()
const { uploading: uploadingDump, dumpName, upload: uploadDump, remove: removeDump } = useProjectDump(project)
const confirmRemoveDump = ref(false)
const removingDump = ref(false)
async function confirmDumpRemoval() {
  removingDump.value = true
  await removeDump()
  removingDump.value = false
  confirmRemoveDump.value = false
}

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
</script>

<template>
  <div
    v-if="project"
    class="grid grid-cols-1 items-start gap-4.5 xl:grid-cols-[2fr_1fr]"
  >
    <div class="flex flex-col gap-4.5">
      <KPanel
        title="Env variables"
        icon="i-lucide-key-round"
        accent="var(--text-primary)"
      >
        <template #action>
          <KSaveStatus
            v-if="envVarsState !== 'idle'"
            :state="envVarsState"
            :error-text="envVarsError"
          />
        </template>

        <div>
          <p class="mb-2.5 text-xs leading-relaxed text-dimmed">
            One <code class="k-code">KEY=value</code> per line, like a .env file. Values can use
            <code class="k-code">$KNECHT_PREVIEW_URL</code> and <code class="k-code">$KNECHT_DEV_SERVER_URL</code>
            to follow the run's URLs.
          </p>
          <div class="k-code-box">
            <WorkflowCodeEditor
              v-model="envText"
              lang="bash"
              :rows="10"
              :max-height="350"
              :placeholder="'DATABASE_URL=mysql://db/app\nAPI_KEY=sk-abc123'"
            />
          </div>

          <div
            v-if="envSource === 'ddev'"
            class="mt-4"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <UTooltip
                text="Where the site's base URLs live. Applies to new runs."
                :content="{ side: 'top', align: 'start' }"
              >
                <span class="k-label flex items-center gap-1.5">
                  Base URLs
                  <UIcon
                    name="i-lucide-info"
                    class="size-3"
                  />
                </span>
              </UTooltip>
              <div class="flex rounded-md border border-default p-0.5">
                <UTooltip
                  v-for="option in urlModeOptions"
                  :key="option.value"
                  :text="option.description"
                >
                  <button
                    type="button"
                    class="k-mono cursor-pointer rounded px-2.5 py-1 text-2xs transition-colors"
                    :class="urlMode === option.value ? 'bg-(--surface-accented) text-highlighted' : 'text-dimmed hover:text-muted'"
                    :aria-pressed="urlMode === option.value"
                    @click="setUrlMode(option.value)"
                  >
                    {{ option.title }}
                  </button>
                </UTooltip>
              </div>
            </div>
          </div>
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
          <p class="mb-2.5 text-xs leading-relaxed text-dimmed">
            What has to run after <code class="k-code">ddev start</code> and the
            database import before the site works. One command per line, run
            once per session, before any workflow-specific boot commands.
          </p>
          <div class="k-code-box">
            <WorkflowCodeEditor
              v-model="bootCommands"
              lang="bash"
              :rows="3"
              placeholder="ddev composer install"
            />
          </div>
        </div>
      </KPanel>
    </div>
    <div class="flex flex-col gap-4.5">
      <KPanel
        title="Environment"
        icon="i-lucide-database"
      >
        <template #action>
          <KSaveStatus
            v-if="envState !== 'idle'"
            :state="envState"
            :error-text="envError"
          />
        </template>
        <p
          v-if="!project.ddevEnv"
          class="k-mono text-2xs text-dimmed"
        >
          Resolving environment…
        </p>
        <div
          v-else
          class="flex flex-col gap-3"
        >
          <div
            v-if="envSource === 'ddev'"
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
          <div
            v-else
            class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2"
          >
            <span class="k-label">Framework</span>
            <span class="k-mono text-xs text-toned">{{ fwLabel }}</span>
            <span class="k-label">PHP</span>
            <USelectMenu
              :model-value="phpItems.find(i => i.value === phpOverride)"
              :items="phpItems"
              :search-input="false"
              class="w-full"
              @update:model-value="(item: { value: string | null } | undefined) => phpOverride = item?.value ?? null"
            />
            <span class="k-label">Node</span>
            <USelectMenu
              :model-value="nodeItems.find(i => i.value === nodeOverride)"
              :items="nodeItems"
              :search-input="false"
              class="w-full"
              @update:model-value="(item: { value: string | null } | undefined) => nodeOverride = item?.value ?? null"
            />
            <span class="k-label">Package manager</span>
            <USelectMenu
              :model-value="packageManagerItems.find(i => i.value === packageManagerOverride)"
              :items="packageManagerItems"
              :search-input="false"
              class="w-full"
              @update:model-value="(item: { value: string | null } | undefined) => packageManagerOverride = (item?.value ?? null) as PackageManagerName | null"
            />
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
        title="Dev server"
        icon="i-lucide-server"
      >
        <template #action>
          <KSaveStatus
            v-if="devState !== 'idle'"
            :state="devState"
            :error-text="devError"
          />
        </template>
        <div>
          <p class="mb-2.5 text-xs leading-relaxed text-dimmed">
            The command that starts your dev server, for example
            <code class="k-code">npm run dev</code> for Vite hot reloading, and
            the port it listens on. Without a ddev config in the repo this is
            what the preview shows.
          </p>
          <div class="grid grid-cols-[1fr_7rem] gap-2">
            <div class="k-code-box">
              <WorkflowCodeEditor
                v-model="devServer"
                lang="bash"
                :rows="1"
                placeholder="npm run dev"
              />
            </div>
            <UInput
              v-model="previewPort"
              placeholder="Port"
              inputmode="numeric"
              size="sm"
              :ui="{ base: 'k-mono text-xs' }"
            />
          </div>
        </div>
      </KPanel>
      <KPanel
        v-if="resolvedEnv.hasDb.value"
        title="Database dump"
        icon="i-lucide-hard-drive-download"
      >
        <div class="flex flex-col items-start">
          <div
            v-if="dumpName"
            class="flex w-full items-center gap-2"
          >
            <UIcon
              name="i-lucide-database"
              class="size-4 flex-none text-dimmed"
            />
            <span class="k-mono flex-1 truncate text-2xs text-muted">{{ dumpName }}</span>
            <UTooltip text="Replace dump">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                aria-label="Replace dump"
                :loading="uploadingDump"
                @click="dumpInput?.click()"
              />
            </UTooltip>
            <UTooltip text="Remove dump">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                aria-label="Remove dump"
                @click="confirmRemoveDump = true"
              />
            </UTooltip>
          </div>
          <input
            ref="dumpInput"
            type="file"
            class="hidden"
            accept=".sql,.gz,.sql.gz,.zip,.bz2,.xz,.tar,.mysql"
            @change="uploadDump"
          >
          <UButton
            v-if="!dumpName"
            label="Upload dump"
            icon="i-lucide-upload"
            variant="outline"
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
          <p class="text-xs leading-relaxed text-dimmed">
            Folders that keep their files across all runs and previews, like a CMS uploads folder that is not in git.
          </p>
          <div
            v-for="folder in sharedFolders"
            :key="folder"
            class="mt-2.5 flex w-full items-center gap-2"
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
                @click="pickSeed(folder)"
              />
            </UTooltip>
            <UTooltip text="Stop persisting this folder">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="`Stop persisting ${folder}`"
                @click="saveFolders(sharedFolders.filter(f => f !== folder))"
              />
            </UTooltip>
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
              variant="outline"
              color="neutral"
              size="sm"
              :loading="savingFolders"
              :disabled="!newFolder.trim()"
            />
          </form>
        </div>
      </KPanel>
    </div>

    <KConfirmModal
      v-model:open="confirmRemoveDump"
      title="Remove database dump"
      :description="`Removes ${dumpName}. New environments no longer import a dump until you upload another one.`"
      confirm-label="Remove"
      :loading="removingDump"
      @confirm="confirmDumpRemoval"
    />
  </div>
</template>
