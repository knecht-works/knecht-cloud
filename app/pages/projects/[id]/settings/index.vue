<script setup lang="ts">
import { DDEV_DATABASE_GROUPS, DDEV_PHP_VERSIONS, ENV_DEFAULTS, NODE_LTS_MAJORS, PACKAGE_MANAGERS, type EnvSpec, type DdevDatabase, type PackageManagerName, formatDatabase, formatPackageManager, projectDetectedEnv, resolveEnv } from '#shared/utils/env-spec'
import { formatBytes } from '#shared/utils/bytes'
import { PREVIEW_FORWARD_PORT } from '#shared/utils/preview-host'
import { useToastError } from '~/composables/useToastError'
import { useRoute, $fetch } from '#imports'
import { useProject } from '~/composables/useProjects'
import { computed, ref, watch } from 'vue'
import { frameworkMeta } from '~/utils/dashboard'
import { useAutosave } from '~/composables/useAutosave'
import { envVarsToText, parseEnvText } from '#shared/utils/env'
import { useProjectDump } from '~/composables/useProjectDump'
import KSaveStatus from '~/components/KSaveStatus.vue'
import WorkflowCodeEditor from '~/components/workflow/CodeEditor.vue'
import KPanel from '~/components/KPanel.vue'
import KDumpProgress from '~/components/KDumpProgress.vue'
import KUploadButton from '~/components/KUploadButton.vue'
import KConfirmModal from '~/components/KConfirmModal.vue'
import KSettingRow from '~/components/KSettingRow.vue'
import { UIcon, UTooltip, UInput, USelectMenu, UButton } from '#components'

const toastError = useToastError()
const id = Number(useRoute().params.id)

const { data: project } = await useProject(id)

const fwLabel = computed(() => {
  const label = frameworkMeta(project.value?.framework).label
  return project.value?.frameworkVersion ? `${label} ${project.value.frameworkVersion}` : label
})

const detectedEnv = computed(() => projectDetectedEnv(project.value?.ddevEnv))
const envSource = computed(() => detectedEnv.value.source)

const phpOverride = ref<string | null>(project.value?.phpVersion ?? null)
const nodeOverride = ref<string | null>(project.value?.nodeVersion ?? null)
const packageManagerOverride = ref<PackageManagerName | null>(project.value?.packageManager ?? null)
const databaseOverride = ref<DdevDatabase | null>(project.value?.database ?? null)
const envOverrides = computed(() => ({
  phpVersion: phpOverride.value,
  nodeVersion: nodeOverride.value,
  packageManager: packageManagerOverride.value,
  database: databaseOverride.value,
}))
function overrideItems<K extends 'phpVersion' | 'nodeVersion' | 'packageManager'>(field: K, choices: readonly string[], format: (value: EnvSpec[K]) => string) {
  const detected = detectedEnv.value.fields[field]
  const label = detected
    ? `Detected: ${format(detected.value)}`
    : `Default: ${format(ENV_DEFAULTS[field])}`
  return [{ label, value: null as string | null }, ...choices.map(v => ({ label: v, value: v }))]
}
const phpItems = computed(() => overrideItems('phpVersion', [...DDEV_PHP_VERSIONS].reverse(), String))
const nodeItems = computed(() => overrideItems('nodeVersion', NODE_LTS_MAJORS, String))
const packageManagerItems = computed(() => overrideItems('packageManager', PACKAGE_MANAGERS, formatPackageManager))
const databaseItems = [
  [{ label: 'None', value: null as DdevDatabase | null }],
  ...DDEV_DATABASE_GROUPS.map(group => group.map(value => ({ label: formatDatabase(value), value }))),
]

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

const { dumpName, uploadKey: dumpUploadKey, uploadUrl: dumpUploadUrl, settingsPath, upload: dumpUpload, progress: dumpProgress, uploaded: dumpUploaded, remove: removeDump, rebuildBase, cancel: cancelDump } = useProjectDump(project)
const startingBase = ref(false)
async function startBase() {
  startingBase.value = true
  await rebuildBase()
  startingBase.value = false
}
// The bar replaces the upload buttons, so nothing else takes the new project from the finished upload.
watch(() => dumpUpload.value?.promise, (promise) => {
  promise?.then(dumpUploaded, () => {})
})
const dumpState = computed(() => {
  const base = project.value?.dbBase
  if (!base) return { text: 'Not imported yet', action: 'Import' }
  if (base.state === 'failed') return { text: `Import failed: ${base.error}`, failed: true, action: 'Retry' }
  return null
})
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

const removeFolderTarget = ref<string | null>(null)
const confirmingFolderRemoval = computed({
  get: () => removeFolderTarget.value !== null,
  set: (open) => { if (!open) removeFolderTarget.value = null },
})
async function removeFolder() {
  await saveFolders(sharedFolders.value.filter(f => f !== removeFolderTarget.value))
  removeFolderTarget.value = null
}

async function addFolder() {
  const path = newFolder.value.trim()
  if (!path) return
  await saveFolders([...sharedFolders.value, path])
  newFolder.value = ''
}

const seedUrl = (folder: string) => () => `/api/projects/${id}/shared?path=${encodeURIComponent(folder)}`

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
    class="flex flex-col gap-4.5"
  >
    <KPanel
      title="Environment"
      icon="i-lucide-database"
    >
      <template #action>
        <span class="flex items-center gap-3">
          <KSaveStatus
            :state="envState"
            :error-text="envError"
          />
          <KSaveStatus
            :state="bootState"
            :error-text="bootError"
          />
          <KSaveStatus
            :state="devState"
            :error-text="devError"
          />
        </span>
      </template>
      <div>
        <KSettingRow
          v-if="envSource !== 'ddev'"
          label="Stack"
          :hint="`${fwLabel}, detected from the repository. Override a version if it is wrong.`"
        >
          <div class="grid grid-cols-2 gap-x-2 gap-y-2.5">
            <label class="flex flex-col gap-1 text-xs text-muted">
              PHP
              <USelectMenu
                :model-value="phpItems.find(i => i.value === phpOverride)"
                :items="phpItems"
                :search-input="false"
                class="w-full"
                @update:model-value="(item: { value: string | null } | undefined) => phpOverride = item?.value ?? null"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-muted">
              Node
              <USelectMenu
                :model-value="nodeItems.find(i => i.value === nodeOverride)"
                :items="nodeItems"
                :search-input="false"
                class="w-full"
                @update:model-value="(item: { value: string | null } | undefined) => nodeOverride = item?.value ?? null"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-muted">
              Package manager
              <USelectMenu
                :model-value="packageManagerItems.find(i => i.value === packageManagerOverride)"
                :items="packageManagerItems"
                :search-input="false"
                class="w-full"
                @update:model-value="(item: { value: string | null } | undefined) => packageManagerOverride = (item?.value ?? null) as PackageManagerName | null"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-muted">
              Database
              <USelectMenu
                :model-value="databaseItems.flat().find(i => i.value === databaseOverride)"
                :items="databaseItems"
                class="w-full"
                @update:model-value="(item: { value: DdevDatabase | null } | undefined) => databaseOverride = item?.value ?? null"
              />
            </label>
          </div>
        </KSettingRow>
        <KSettingRow
          v-if="resolvedEnv.hasDb.value"
          label="Database dump"
          hint="Imported into every new environment."
        >
          <div
            v-if="dumpProgress || dumpName"
            class="w-full"
          >
            <KDumpProgress
              v-if="dumpProgress"
              :progress="dumpProgress"
              :uploading="!!dumpUpload"
              @cancel="cancelDump"
            />
            <div
              v-else
              class="flex h-6 items-center gap-2"
            >
              <UIcon
                name="i-lucide-database"
                class="size-4 flex-none text-dimmed"
              />
              <span class="flex-1 truncate text-xs text-muted">{{ dumpName }}</span>
              <span
                v-if="project?.dbDumpSize"
                class="flex-none text-xs text-dimmed"
              >{{ formatBytes(project.dbDumpSize) }}</span>
              <KUploadButton
                :upload-key="dumpUploadKey"
                :url="dumpUploadUrl"
                :to="settingsPath"
                accept=".sql,.gz,.sql.gz,.zip,.bz2,.xz,.tar,.mysql"
                quiet
                tooltip="Replace dump"
                aria-label="Replace dump"
                icon="i-lucide-refresh-cw"
                size="xs"
                color="neutral"
                variant="ghost"
              />
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
            <div
              v-if="!dumpProgress && dumpState"
              class="mt-1 flex min-h-6 items-start gap-2"
            >
              <span
                class="min-w-0 flex-1 self-center wrap-break-word text-xs"
                :class="dumpState.failed ? '' : 'text-muted'"
                :style="dumpState.failed ? { color: 'var(--status-error)' } : undefined"
              >{{ dumpState.text }}</span>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                :label="dumpState.action"
                :loading="startingBase"
                @click="startBase"
              />
            </div>
          </div>
          <KUploadButton
            v-else
            :upload-key="dumpUploadKey"
            :url="dumpUploadUrl"
            :to="settingsPath"
            accept=".sql,.gz,.sql.gz,.zip,.bz2,.xz,.tar,.mysql"
            quiet
            label="Upload dump"
            variant="outline"
            color="neutral"
            size="sm"
          />
        </KSettingRow>
        <KSettingRow
          label="Persistent folders"
          hint="Folders that keep their files across all runs and previews, like a CMS uploads folder that is not in git."
        >
          <div
            v-for="folder in sharedFolders"
            :key="folder"
            class="mb-2 flex w-full items-center gap-2"
          >
            <UIcon
              name="i-lucide-folder-sync"
              class="size-4 flex-none text-dimmed"
            />
            <span class="flex-1 truncate text-xs text-muted">{{ folder }}</span>
            <KUploadButton
              :upload-key="`shared:${id}:${folder}`"
              :url="seedUrl(folder)"
              :to="settingsPath"
              accept=".zip"
              tooltip="Fill this folder from a zip"
              :aria-label="`Fill ${folder} from a zip`"
              icon="i-lucide-upload"
              size="xs"
              color="neutral"
              variant="ghost"
            />
            <UTooltip text="Stop persisting this folder">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="`Stop persisting ${folder}`"
                @click="removeFolderTarget = folder"
              />
            </UTooltip>
          </div>
          <form
            class="flex items-center gap-2"
            @submit.prevent="addFolder"
          >
            <UInput
              v-model="newFolder"
              placeholder="web/uploads"
              aria-label="Folder"
              class="flex-1"
            />
            <UButton
              type="submit"
              icon="i-lucide-plus"
              aria-label="Add folder"
              variant="outline"
              color="neutral"
              :loading="savingFolders"
              :disabled="!newFolder.trim()"
            />
          </form>
        </KSettingRow>
        <KSettingRow
          label="Boot commands"
          hint="Runs once per session after the environment and database are up, before workflow boot commands. One command per line."
        >
          <div class="k-code-box">
            <WorkflowCodeEditor
              v-model="bootCommands"
              lang="bash"
              :rows="3"
              placeholder="ddev composer install"
            />
          </div>
        </KSettingRow>
        <KSettingRow label="Dev server">
          <template #hint>
            Command and port, like <code class="k-code">npm run dev</code>. Previewed without a ddev config.
          </template>
          <div class="grid grid-cols-[1fr_5.5rem] items-start gap-2">
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
              aria-label="Port"
              inputmode="numeric"
            />
          </div>
        </KSettingRow>
        <KSettingRow
          v-if="envSource === 'ddev'"
          label="Base URLs"
          hint="Where the site's base URLs live. Applies to new runs."
        >
          <div class="flex h-9 rounded-md border border-default p-0.5">
            <UTooltip
              v-for="option in urlModeOptions"
              :key="option.value"
              :text="option.description"
            >
              <button
                type="button"
                class="flex-1 cursor-pointer rounded px-2.5 py-1 text-xs transition-colors"
                :class="urlMode === option.value ? 'bg-(--surface-accented) text-highlighted' : 'text-dimmed hover:text-muted'"
                :aria-pressed="urlMode === option.value"
                @click="setUrlMode(option.value)"
              >
                {{ option.title }}
              </button>
            </UTooltip>
          </div>
        </KSettingRow>
      </div>
      <p
        v-for="warning in detectedEnv.warnings"
        :key="warning"
        class="mt-3 text-xs"
        style="color: var(--status-warning, var(--accent-orange))"
      >
        {{ warning }}
      </p>
    </KPanel>

    <KPanel
      title="Env variables"
      icon="i-lucide-key-round"
      accent="var(--text-primary)"
    >
      <template #action>
        <KSaveStatus
          :state="envVarsState"
          :error-text="envVarsError"
        />
      </template>
      <p class="mb-2.5 text-xs leading-relaxed text-muted">
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
    </KPanel>

    <KConfirmModal
      v-model:open="confirmRemoveDump"
      title="Remove database dump"
      description="New environments start without its data."
      :detail="`Removes ${dumpName}. New environments no longer import a dump until you upload another one.`"
      confirm-label="Remove"
      :loading="removingDump"
      @confirm="confirmDumpRemoval"
    />

    <KConfirmModal
      v-model:open="confirmingFolderRemoval"
      :title="`Stop persisting ${removeFolderTarget}?`"
      description="Its files stay stored. Add the folder again to get them back."
      :detail="`From now on, every run and preview gets ${removeFolderTarget} as it is in the repository, without the shared files.`"
      confirm-label="Stop persisting"
      :loading="savingFolders"
      @confirm="removeFolder"
    />
  </div>
</template>
