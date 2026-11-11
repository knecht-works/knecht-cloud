<script setup lang="ts">
import { runWorkspacePath } from '#shared/utils/routes'
import { PREVIEW_FORWARD_PORT } from '#shared/utils/preview-host'
import { DDEV_DATABASE_GROUPS, formatDatabase, projectDetectedEnv, resolveEnv, type DdevDatabase, type DetectedEnv } from '#shared/utils/env-spec'

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [] }>()

const toastError = useToastError()

interface ProjectRow {
  id: number
  fullName: string
  dbDumpPath: string | null
}

const STEPS = [
  { key: 'repo', label: 'Repository' },
  { key: 'env', label: 'Environment' },
  { key: 'commands', label: 'Commands' },
] as const
type StepKey = typeof STEPS[number]['key'] | 'done'

const step = ref<StepKey>('repo')
const project = ref<ProjectRow | null>(null)
const stepIndex = computed(() => STEPS.findIndex(s => s.key === step.value))

const { data: repos, status: reposStatus, execute: loadRepos } = useFetch('/api/github/repos', {
  immediate: false,
  transform: rows => rows.map(r => ({ ...r, label: r.fullName, description: r.description ?? undefined })),
})

const selected = ref()
const branch = ref<string>()
watch(selected, (repo) => {
  branch.value = repo?.defaultBranch
})
const { items: branches, loading: loadingBranches } = useBranchPicker(
  () => selected.value ? `/api/github/repos/${selected.value.owner}/${selected.value.name}/branches` : null,
  () => selected.value?.defaultBranch,
)

const { data: projects } = useProjects()
const repoItems = computed(() => (repos.value ?? []).map((r) => {
  const connected = projects.value.some(p => p.repoProvider === r.repoProvider && p.repoId === r.repoId)
  return connected ? { ...r, disabled: true, description: 'Already connected' } : r
}))

const detected = ref<DetectedEnv | null>(null)
const checkingRepo = ref(false)

async function continueFromRepo() {
  if (!selected.value) return
  checkingRepo.value = true
  try {
    const meta = await $fetch(`/api/github/repos/${selected.value.owner}/${selected.value.name}/meta`, { query: { branch: branch.value } })
    detected.value = meta.ddevEnv.detected ?? null
  }
  catch {
    // Unreadable repos are treated like ddev ones; the server reads them again on create.
    detected.value = null
  }
  finally {
    checkingRepo.value = false
  }
  step.value = 'env'
}

const envText = ref('')
const bootCommands = ref('')
const devServer = ref('')
const previewPort = ref('')
const previewPortNumber = computed(() => /^\d+$/.test(previewPort.value.trim()) ? Number(previewPort.value.trim()) : null)
const commandsError = computed(() => {
  const port = previewPortNumber.value
  if (devServer.value.trim() && port === null) return 'Add the port the dev server listens on'
  if (port !== null && (port < 1 || port > 65535)) return 'The port must be between 1 and 65535'
  if (port === PREVIEW_FORWARD_PORT) return `Port ${PREVIEW_FORWARD_PORT} is reserved for the preview`
  return undefined
})

const database = ref<DdevDatabase | null>(null)
const resolvedEnv = computed(() => resolveEnv(projectDetectedEnv(detected.value ? { detected: detected.value } : null), {
  phpVersion: null,
  nodeVersion: null,
  packageManager: null,
  database: database.value,
  devServer: null,
  previewPort: null,
}))
const databaseItems = [
  [{ label: 'None', value: null as DdevDatabase | null }],
  ...DDEV_DATABASE_GROUPS.map(group => group.map(value => ({ label: formatDatabase(value), value }))),
]

const dumpInput = ref<HTMLInputElement>()
const dumpFile = ref<File | null>(null)
const hasEnv = computed(() => !!(envText.value.trim() || database.value || dumpFile.value))
function pickDump() {
  dumpFile.value = dumpInput.value?.files?.[0] ?? null
  if (dumpInput.value) dumpInput.value.value = ''
}

const reachedIndex = ref(0)
watch(step, () => {
  reachedIndex.value = Math.max(reachedIndex.value, step.value === 'done' ? STEPS.length : stepIndex.value)
})
const canOpenStep = (i: number) => !project.value && i !== stepIndex.value && i <= reachedIndex.value
const stepComplete = (i: number) => step.value === 'done' || (i !== stepIndex.value && i < reachedIndex.value)

const { uploadKey, uploadUrl, settingsPath } = useProjectDump(project)
const { find: findUpload, start: startUpload } = useUploads()
const dumpUploading = computed(() => !!project.value && !!findUpload(uploadKey.value))

const creating = ref(false)
const createError = ref<string | null>(null)

async function create() {
  if (!selected.value) return
  creating.value = true
  createError.value = null
  const command = devServer.value.trim() || null
  try {
    project.value = await $fetch('/api/projects', {
      method: 'POST',
      body: {
        repoProvider: selected.value.repoProvider,
        repoId: selected.value.repoId,
        owner: selected.value.owner,
        name: selected.value.name,
        fullName: selected.value.fullName,
        defaultBranch: branch.value ?? selected.value.defaultBranch,
        private: selected.value.private,
        envVars: parseEnvText(envText.value),
        bootCommands: bootCommands.value,
        database: resolvedEnv.value.source === 'generated' ? database.value : null,
        devServer: command,
        previewPort: command ? previewPortNumber.value : null,
      },
    })
    emit('created')
    if (dumpFile.value && resolvedEnv.value.hasDb.value) {
      startUpload({ key: uploadKey.value, url: uploadUrl(dumpFile.value), file: dumpFile.value, to: settingsPath.value })
    }
    step.value = 'done'
  }
  catch (e) {
    createError.value = errMsg(e, 'Failed to create the project. Please try again.')
  }
  finally {
    creating.value = false
  }
}

const { data: workflowRows } = useWorkflows()
const bootWorkflow = computed(() => workflowRows.value.find(w => w.name === 'boot-and-preview' && workflowRunnable(w)))
const hasBootWorkflow = computed(() => !!bootWorkflow.value)

const booting = ref(false)

async function openProject() {
  if (!project.value) return
  const id = project.value.id
  open.value = false
  await navigateTo(`/projects/${id}`)
}

async function bootAndPreview() {
  if (!project.value || !bootWorkflow.value) return
  booting.value = true
  try {
    const run = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: project.value.id, workflowId: bootWorkflow.value.id },
    })
    open.value = false
    await navigateTo(runWorkspacePath(run.projectId, run.id))
  }
  catch (e) {
    booting.value = false
    toastError('Failed to start run', e)
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    if (!repos.value) loadRepos()
    return
  }
  step.value = 'repo'
  reachedIndex.value = 0
  project.value = null
  selected.value = undefined
  branch.value = undefined
  detected.value = null
  envText.value = ''
  bootCommands.value = ''
  devServer.value = ''
  previewPort.value = ''
  database.value = null
  dumpFile.value = null
  createError.value = null
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="Set up a project"
    description="Connect a GitHub repo and add what it needs to boot."
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="flex min-h-130 flex-col">
        <div class="mb-6 flex items-center">
          <template
            v-for="(s, i) in STEPS"
            :key="s.key"
          >
            <button
              type="button"
              class="group flex items-center gap-2 enabled:cursor-pointer"
              :disabled="!canOpenStep(i)"
              @click="() => { step = s.key }"
            >
              <span
                class="k-mono grid size-6 flex-none place-items-center rounded-full border text-2xs transition-colors"
                :class="stepComplete(i)
                  ? 'border-(--primary-border) bg-(--lime-950) text-primary'
                  : i === stepIndex
                    ? 'border-default bg-(--surface-glass) text-highlighted'
                    : 'border-muted text-dimmed'"
              >
                <UIcon
                  v-if="stepComplete(i)"
                  name="i-lucide-check"
                  class="size-3.5"
                />
                <span v-else>{{ i + 1 }}</span>
              </span>
              <span
                class="text-xs transition-colors group-enabled:group-hover:text-toned"
                :class="i === stepIndex ? 'text-toned' : 'text-dimmed'"
              >{{ s.label }}</span>
            </button>
            <div
              v-if="i < STEPS.length - 1"
              class="mx-2.5 h-px flex-1 bg-(--border-muted)"
            />
          </template>
        </div>

        <div
          v-if="step === 'repo'"
          class="flex flex-1 flex-col space-y-4"
        >
          <UFormField
            label="Repository"
            help="Boots from its ddev config, or from a generated one if it has none."
          >
            <USelectMenu
              v-model="selected"
              :items="repoItems"
              :loading="reposStatus === 'pending'"
              placeholder="Select a repo…"
              icon="i-simple-icons-github"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Branch"
            help="Runs check out this branch and open pull requests against it."
          >
            <USelectMenu
              v-model="branch"
              :items="branches"
              :loading="loadingBranches"
              :disabled="!selected"
              placeholder="Branch…"
              icon="i-lucide-git-branch"
              class="w-full"
            />
          </UFormField>
          <div class="mt-auto flex justify-end gap-2">
            <UButton
              size="lg"
              label="Continue"
              color="primary"
              :loading="checkingRepo"
              :disabled="!selected"
              @click="continueFromRepo"
            />
          </div>
        </div>

        <div
          v-else-if="step === 'env'"
          class="flex flex-1 flex-col space-y-4"
        >
          <UFormField
            label="Env variables"
            help="One KEY=value per line. Paste the project's .env. You can edit these later."
          >
            <div class="k-code-box">
              <WorkflowCodeEditor
                v-model="envText"
                lang="bash"
                :rows="6"
                :max-height="200"
                :placeholder="'DATABASE_URL=mysql://db/app\nAPI_KEY=sk-abc123'"
              />
            </div>
          </UFormField>
          <UFormField
            v-if="resolvedEnv.source === 'generated'"
            label="Database"
            help="Pick a database if your project needs one."
          >
            <USelectMenu
              :model-value="databaseItems.flat().find(i => i.value === database)"
              :items="databaseItems"
              class="w-full"
              @update:model-value="(item: { value: DdevDatabase | null } | undefined) => database = item?.value ?? null"
            />
          </UFormField>
          <UFormField
            v-if="resolvedEnv.hasDb.value"
            label="Database dump"
            help="Start the environment with your existing data."
          >
            <input
              ref="dumpInput"
              type="file"
              class="hidden"
              accept=".sql,.gz,.sql.gz,.zip,.bz2,.xz,.tar,.mysql"
              @change="pickDump"
            >
            <div
              v-if="dumpFile"
              class="flex h-9 items-center gap-2 rounded-md border border-muted bg-(--surface-muted) ps-3 pe-1"
            >
              <UIcon
                name="i-lucide-database"
                class="size-4 flex-none text-primary"
              />
              <span class="k-mono flex-1 truncate text-xs text-muted">{{ dumpFile.name }}</span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                aria-label="Remove dump"
                @click="() => { dumpFile = null }"
              />
            </div>
            <UButton
              v-else
              label="Choose dump"
              variant="outline"
              color="neutral"
              @click="dumpInput?.click()"
            />
          </UFormField>
          <div class="mt-auto flex justify-end gap-2">
            <UButton
              size="lg"
              :label="hasEnv ? 'Continue' : 'Skip'"
              :color="hasEnv ? 'primary' : 'neutral'"
              :variant="hasEnv ? 'solid' : 'outline'"
              @click="() => { step = 'commands' }"
            />
          </div>
        </div>

        <div
          v-else-if="step === 'commands'"
          class="flex flex-1 flex-col space-y-4"
        >
          <UFormField
            label="Boot commands"
            help="Commands that need to run to start a preview environment."
          >
            <div class="k-code-box">
              <WorkflowCodeEditor
                v-model="bootCommands"
                lang="bash"
                :rows="6"
                :max-height="200"
                placeholder="composer install"
              />
            </div>
          </UFormField>
          <UFormField
            label="Dev server"
            help="Starts your dev server, for example for Vite hot reloading, on the port it listens on."
            :error="commandsError"
          >
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
                aria-label="Port"
                inputmode="numeric"
              />
            </div>
          </UFormField>
          <p
            v-if="createError"
            class="flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs"
            style="border-color: color-mix(in oklab, var(--status-error) 45%, transparent); background: color-mix(in oklab, var(--status-error) 10%, transparent); color: var(--status-error)"
          >
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-3.5 flex-none"
            />
            <span>{{ createError }}</span>
          </p>
          <div class="mt-auto flex justify-end gap-2">
            <UButton
              size="lg"
              label="Create project"
              color="primary"
              :loading="creating"
              :disabled="!!commandsError"
              @click="create"
            />
          </div>
        </div>

        <div
          v-else
          class="flex flex-1 flex-col items-center justify-center gap-4 py-2 text-center"
        >
          <span class="grid size-12 place-items-center rounded-full border border-(--primary-border) bg-(--lime-950) text-primary">
            <UIcon
              name="i-lucide-check"
              class="size-6"
            />
          </span>
          <div>
            <p class="text-base font-medium text-highlighted">
              {{ project?.fullName.split('/').pop() }} is ready
            </p>
            <p class="mx-auto mt-1 max-w-80 text-xs text-dimmed">
              {{ dumpUploading
                ? 'The database dump is still uploading. Boot the project once it is done.'
                : hasBootWorkflow
                  ? 'Boot it to import the database, build, and open a live preview, or open the project to review the setup first.'
                  : 'Open the project to review the setup and start your first run.' }}
            </p>
          </div>
          <div class="mt-1 flex w-full justify-center gap-2">
            <UButton
              size="lg"
              color="neutral"
              variant="outline"
              label="Open project"
              @click="openProject"
            />
            <UButton
              v-if="hasBootWorkflow"
              size="lg"
              color="primary"
              label="Boot & preview"
              :loading="booting"
              :disabled="dumpUploading"
              @click="bootAndPreview"
            />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
