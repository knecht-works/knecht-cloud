<script setup lang="ts">
// Guided project setup: connect a repo, then immediately add the env variables
// and database dump it needs to boot, so a freshly connected project is ready
// to preview. The project is created at the first step (its id is needed for the
// env/dump calls); the later steps are optional and editable later on the
// detail page.
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [] }>()

const toastError = useToastError()

interface ProjectRow {
  id: number
  fullName: string
  framework: string | null
  frameworkVersion: string | null
  dbDumpPath: string | null
}

const STEPS = [
  { key: 'repo', label: 'Repository' },
  { key: 'env', label: 'Environment' },
  { key: 'database', label: 'Database' },
] as const
type StepKey = typeof STEPS[number]['key'] | 'done'

const step = ref<StepKey>('repo')
const project = ref<ProjectRow | null>(null)
const stepIndex = computed(() => STEPS.findIndex(s => s.key === step.value))

// ── Step 1 · repo ──────────────────────────────────────────────────────────
const { data: repos, status: reposStatus, execute: loadRepos } = useFetch('/api/github/repos', {
  immediate: false,
  transform: rows => rows.map(r => ({ ...r, label: r.fullName, description: r.description ?? undefined })),
})

const selected = ref()
const connecting = ref(false)

// The branch the project will work on (checkout + PR base). Defaults to the
// repo's default branch; the full list loads once a repo is picked.
const branch = ref<string>()
watch(selected, repo => branch.value = repo?.defaultBranch)
const { items: branches, loading: loadingBranches } = useBranchPicker(
  () => selected.value ? `/api/github/repos/${selected.value.owner}/${selected.value.name}/branches` : null,
  () => selected.value?.defaultBranch,
)

async function connect() {
  if (!selected.value) return
  connecting.value = true
  try {
    project.value = await $fetch('/api/projects', {
      method: 'POST',
      body: {
        githubId: selected.value.githubId,
        owner: selected.value.owner,
        name: selected.value.name,
        fullName: selected.value.fullName,
        defaultBranch: branch.value ?? selected.value.defaultBranch,
        private: selected.value.private,
        cloneUrl: selected.value.cloneUrl,
      },
    })
    emit('created')
    step.value = 'env'
  }
  catch (e) {
    toastError('Failed to connect', e)
  }
  finally {
    connecting.value = false
  }
}

// ── Step 2 · env variables ───────────────────────────────────────────────────
const envText = ref('')
const savingEnv = ref(false)

async function saveEnvAndContinue() {
  if (!project.value) return
  savingEnv.value = true
  try {
    await $fetch(`/api/projects/${project.value.id}`, {
      method: 'PATCH',
      body: { envVars: parseEnvText(envText.value) },
    })
    step.value = 'database'
  }
  catch (e) {
    toastError('Failed to save', e)
  }
  finally {
    savingEnv.value = false
  }
}

// ── Step 3 · database dump (shared with the project page via useProjectDump) ──
const dumpInput = ref<HTMLInputElement>()
const { uploading: uploadingDump, dumpName, upload: uploadDump } = useProjectDump(project)

// ── Step 4 · finish ──────────────────────────────────────────────────────────
const booting = ref(false)

async function openProject() {
  if (!project.value) return
  const id = project.value.id
  open.value = false
  await navigateTo(`/projects/${id}`)
}

async function bootAndPreview() {
  if (!project.value) return
  booting.value = true
  try {
    const run = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: project.value.id, workflow: 'boot-and-preview' },
    })
    open.value = false
    await navigateTo(`/runs/${run.id}`)
  }
  catch (e) {
    booting.value = false
    toastError('Failed to start run', e)
  }
}

// Load the repo list when the wizard opens; reset everything when it closes so
// reopening starts a fresh setup.
watch(open, (isOpen) => {
  if (isOpen) {
    if (!repos.value) loadRepos()
    return
  }
  step.value = 'repo'
  project.value = null
  selected.value = undefined
  branch.value = undefined
  envText.value = ''
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="Set up a project"
    description="Connect a GitHub repo and add what it needs to boot."
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <!-- Stepper -->
      <div class="mb-6 flex items-center">
        <template
          v-for="(s, i) in STEPS"
          :key="s.key"
        >
          <div class="flex items-center gap-2">
            <span
              class="k-mono grid size-6 flex-none place-items-center rounded-full border text-[11px] transition-colors"
              :class="i < stepIndex || step === 'done'
                ? 'border-(--primary-border) bg-(--lime-950) text-(--primary)'
                : i === stepIndex
                  ? 'border-(--border-default) bg-(--surface-glass) text-(--text-highlighted)'
                  : 'border-(--border-muted) text-(--text-dimmed)'"
            >
              <UIcon
                v-if="i < stepIndex || step === 'done'"
                name="i-lucide-check"
                class="size-3.5"
              />
              <span v-else>{{ i + 1 }}</span>
            </span>
            <span
              class="text-[12.5px] transition-colors"
              :class="i === stepIndex ? 'text-(--text-toned)' : 'text-(--text-dimmed)'"
            >{{ s.label }}</span>
          </div>
          <div
            v-if="i < STEPS.length - 1"
            class="mx-2.5 h-px flex-1 bg-(--border-muted)"
          />
        </template>
      </div>

      <!-- Step 1: repo -->
      <div
        v-if="step === 'repo'"
        class="space-y-4"
      >
        <USelectMenu
          v-model="selected"
          :items="repos ?? []"
          :loading="reposStatus === 'pending'"
          placeholder="Select a repo…"
          icon="i-simple-icons-github"
          class="w-full"
        />
        <USelectMenu
          v-model="branch"
          :items="branches"
          :loading="loadingBranches"
          :disabled="!selected"
          placeholder="Branch…"
          icon="i-lucide-git-branch"
          class="w-full"
        />
        <p class="text-[12.5px] text-(--text-dimmed)">
          The repo must contain a <span class="k-mono">.ddev/config.yaml</span>. Framework, PHP and
          database are read from it automatically. Runs check out the selected branch and open PRs
          against it.
        </p>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="() => { open = false }"
          />
          <UButton
            label="Connect"
            color="primary"
            trailing-icon="i-lucide-arrow-right"
            :loading="connecting"
            :disabled="!selected"
            @click="connect"
          />
        </div>
      </div>

      <!-- Step 2: env variables -->
      <div
        v-else-if="step === 'env'"
        class="space-y-4"
      >
        <div>
          <span class="k-label">Env variables</span>
          <UTextarea
            v-model="envText"
            :rows="9"
            autoresize
            :maxrows="14"
            spellcheck="false"
            :placeholder="'DATABASE_URL=mysql://db/app\nAPI_KEY=sk-abc123'"
            class="mt-2.5 w-full"
            :ui="{ base: 'k-mono text-[12.5px] leading-[1.8] resize-none' }"
          />
          <p class="k-mono mt-2 text-[11px] text-(--text-dimmed)">
            One KEY=value per line. Paste the project's .env. You can edit these later.
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Skip"
            @click="() => { step = 'database' }"
          />
          <UButton
            label="Continue"
            color="primary"
            trailing-icon="i-lucide-arrow-right"
            :loading="savingEnv"
            @click="saveEnvAndContinue"
          />
        </div>
      </div>

      <!-- Step 3: database dump -->
      <div
        v-else-if="step === 'database'"
        class="space-y-4"
      >
        <div>
          <span class="k-label">Database dump</span>
          <p class="mt-1.5 text-[12.5px] text-(--text-dimmed)">
            Optional. Imported into the environment on the first boot.
          </p>
          <div
            v-if="dumpName"
            class="mt-3 flex items-center gap-2 rounded-(--radius-md) border border-(--border-muted) bg-(--surface-muted) px-3 py-2.5"
          >
            <UIcon
              name="i-lucide-database"
              class="size-4 flex-none text-(--text-primary)"
            />
            <span class="k-mono flex-1 truncate text-[12px] text-(--text-muted)">{{ dumpName }}</span>
            <UIcon
              name="i-lucide-check"
              class="size-4 flex-none text-(--text-primary)"
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
            class="mt-3"
            :label="dumpName ? 'Replace dump' : 'Upload dump'"
            icon="i-lucide-upload"
            variant="subtle"
            color="neutral"
            size="sm"
            :loading="uploadingDump"
            @click="dumpInput?.click()"
          />
        </div>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="dumpName ? 'Continue' : 'Skip'"
            @click="() => { step = 'done' }"
          />
          <UButton
            v-if="dumpName"
            label="Done"
            color="primary"
            trailing-icon="i-lucide-arrow-right"
            @click="() => { step = 'done' }"
          />
        </div>
      </div>

      <!-- Step 4: finish -->
      <div
        v-else
        class="flex flex-col items-center gap-4 py-2 text-center"
      >
        <span class="grid size-12 place-items-center rounded-full border border-(--primary-border) bg-(--lime-950) text-(--primary)">
          <UIcon
            name="i-lucide-check"
            class="size-6"
          />
        </span>
        <div>
          <p class="text-[15px] font-medium text-(--text-highlighted)">
            {{ project?.fullName.split('/').pop() }} is ready
          </p>
          <p class="mx-auto mt-1 max-w-[320px] text-[12.5px] text-(--text-dimmed)">
            Boot it to import the database, build, and open a live preview, or open the
            project to review the setup first.
          </p>
        </div>
        <div class="mt-1 flex w-full justify-center gap-2">
          <UButton
            color="neutral"
            variant="outline"
            label="Open project"
            @click="openProject"
          />
          <UButton
            color="primary"
            icon="i-lucide-play"
            label="Boot & preview"
            :loading="booting"
            @click="bootAndPreview"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
