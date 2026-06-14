<script setup lang="ts">
const route = useRoute()
const toast = useToast()
const id = Number(route.params.id)

const { data: project } = await useFetch(`/api/projects/${id}`)
const { data: runs, refresh: refreshRuns } = await useFetch('/api/runs', { default: () => [] })

const fw = computed(() => frameworkMeta(project.value?.framework))
const fwLabel = computed(() =>
  project.value?.frameworkVersion ? `${fw.value.label} ${project.value.frameworkVersion}` : fw.value.label)
const repoName = computed(() => project.value?.fullName.split('/').pop() ?? 'Project')

// This project's runs, newest first (the list is already ordered); the first is
// the latest and drives the preview + status. Per-run logs live on the run page.
const projectRuns = computed(() => (runs.value ?? []).filter(r => r.projectId === id))
const latest = computed(() => projectRuns.value[0] ?? null)

const isLive = computed(() =>
  latest.value?.status === 'queued' || latest.value?.status === 'running')

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
  latest.value ? `${reqUrl.protocol}//${latest.value.id}.preview.${reqUrl.host}/` : '')
const previewOnline = computed(() => latest.value?.envState === 'up')

// ── Start a workflow ─────────────────────────────────────────────────────
const starting = ref(false)
async function startWorkflow() {
  starting.value = true
  try {
    const created = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: id, workflow: 'boot-and-preview' },
    })
    await navigateTo(`/runs/${created.id}`)
  }
  catch (e) {
    starting.value = false
    toast.add({
      title: 'Failed to start run',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
}

// ── Editable config ──────────────────────────────────────────────────────
const siteUrl = ref(project.value?.siteUrl ?? '')
const envVars = ref((project.value?.envVars ?? []).map(e => ({ ...e })))
const saving = ref(false)

function addEnv() {
  envVars.value.push({ key: '', value: '' })
}
function removeEnv(index: number) {
  envVars.value.splice(index, 1)
}

async function save() {
  saving.value = true
  try {
    await $fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      body: {
        siteUrl: siteUrl.value.trim() || null,
        envVars: envVars.value.filter(e => e.key.trim()),
      },
    })
    toast.add({ title: 'Saved', color: 'success' })
  }
  catch (e) {
    toast.add({
      title: 'Failed to save',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}

// Database dump upload
const dumpInput = ref<HTMLInputElement>()
const uploadingDump = ref(false)
const dumpName = computed(() => project.value?.dbDumpPath?.split('/').pop() ?? null)

async function uploadDump(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadingDump.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    project.value = await $fetch(`/api/projects/${id}/dump`, { method: 'POST', body: form })
    toast.add({ title: 'Database dump uploaded', color: 'success' })
  }
  catch (e) {
    toast.add({
      title: 'Upload failed',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
  finally {
    uploadingDump.value = false
    input.value = ''
  }
}

async function removeDump() {
  project.value = await $fetch(`/api/projects/${id}/dump`, { method: 'DELETE' })
  toast.add({ title: 'Dump removed', color: 'success' })
}

// Triggers are not wired yet — shown as a planned, read-only panel.
const PLANNED_TRIGGERS = [
  { name: 'GitHub · Push', sub: 'Run on push to the default branch', icon: 'i-simple-icons-github' },
  { name: 'Schedule', sub: 'Daily at 03:00', icon: 'i-lucide-clock' },
  { name: 'Webhook', sub: 'External issue tracker', icon: 'i-lucide-zap' },
]

// Poll the runs while the latest is still live (updates status + preview state).
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (isLive.value) refreshRuns()
    else if (timer) clearInterval(timer)
  }, 1500)
})
onUnmounted(() => timer && clearInterval(timer))
</script>

<template>
  <div v-if="project">
    <div class="mb-3.5 flex items-center gap-2 text-(--text-dimmed)">
      <NuxtLink
        to="/projects"
        class="k-mono text-xs transition-colors hover:text-(--text-muted)"
      >
        Projects
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <span class="k-mono truncate text-xs text-(--text-muted)">{{ project.fullName }}</span>
    </div>

    <div class="mb-[22px] flex flex-wrap items-start justify-between gap-4">
      <div class="flex gap-3.5">
        <KStepIcon
          icon="i-lucide-box"
          :color="fw.color"
          :size="46"
          :radius="10"
        />
        <div>
          <h1 class="k-mono text-2xl font-semibold tracking-[-0.02em] text-(--text-highlighted)">
            {{ repoName }}
          </h1>
          <div class="mt-2 flex flex-wrap items-center gap-3.5">
            <span
              class="k-mono inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] tracking-[0.04em]"
              :style="{ color: fw.color, borderColor: 'color-mix(in oklab, currentColor 35%, transparent)' }"
            >{{ fwLabel }}</span>
            <span class="flex items-center gap-1.5 text-(--text-dimmed)">
              <UIcon
                name="i-lucide-git-branch"
                class="size-[13px]"
              />
              <span class="k-mono text-xs text-(--text-muted)">{{ project.defaultBranch }}</span>
            </span>
            <span class="flex items-center gap-1.5 text-(--text-dimmed)">
              <UIcon
                name="i-simple-icons-github"
                class="size-[13px]"
              />
              <span class="k-mono text-xs text-(--text-muted)">{{ project.fullName.split('/')[0] }}</span>
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
        <UButton
          color="primary"
          icon="i-lucide-play"
          label="Start workflow"
          :loading="starting"
          @click="startWorkflow"
        />
      </div>
    </div>

    <div class="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[1fr_360px]">
      <!-- LEFT -->
      <div class="flex flex-col gap-[18px]">
        <KBrowserFrame
          :url="previewOnline ? previewUrl.replace(/^https?:\/\//, '') : 'no live preview'"
          :action="previewOnline ? 'live' : 'offline'"
        >
          <iframe
            v-if="previewOnline"
            :src="previewUrl"
            class="h-[260px] w-full"
          />
          <div
            v-else
            class="flex h-[260px] flex-col items-center justify-center gap-3 text-center"
          >
            <img
              src="/mascot/mascotRight.png"
              alt="Knecht"
              class="h-16 w-auto"
              style="filter: var(--drop-shadow-mascot)"
            >
            <p class="max-w-[280px] text-[13px] text-(--text-muted)">
              No live preview yet. Start a workflow to boot the project, then preview it here.
            </p>
          </div>
        </KBrowserFrame>

        <KPanel
          title="Runs"
          icon="i-lucide-play"
          :pad="0"
        >
          <template #action>
            <span class="k-mono text-[11px] text-(--text-dimmed)">{{ projectRuns.length }} {{ projectRuns.length === 1 ? 'run' : 'runs' }}</span>
          </template>

          <div
            v-if="!projectRuns.length"
            class="flex flex-col items-center gap-3 px-5 py-10 text-center"
          >
            <UIcon
              name="i-lucide-play"
              class="size-7 text-(--text-dimmed)"
            />
            <p class="text-[13px] text-(--text-muted)">
              No runs yet. Start a workflow to boot this project.
            </p>
          </div>
          <NuxtLink
            v-for="(r, i) in projectRuns"
            :key="r.id"
            :to="`/runs/${r.id}`"
            class="flex items-center gap-3 px-[18px] py-3 transition-colors hover:bg-(--surface-glass)"
            :class="i ? 'border-t border-(--border-muted)' : ''"
          >
            <KStatusDot
              :color="RUN_STATUS_META[r.status].dot"
              :pulse="RUN_STATUS_META[r.status].pulse"
              :size="6"
            />
            <span class="k-mono text-[12.5px] text-(--text-default)">{{ r.workflow }}</span>
            <span class="k-mono text-[11px] text-(--text-dimmed)">#{{ r.id }}</span>
            <span
              class="k-mono ml-auto text-[11px]"
              :style="{ color: RUN_STATUS_META[r.status].text }"
            >{{ RUN_STATUS_META[r.status].label }}</span>
            <span class="k-mono hidden text-[11px] text-(--text-dimmed) sm:block">{{ timeAgo(r.createdAt) }}</span>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 text-(--text-dimmed)"
            />
          </NuxtLink>
        </KPanel>
      </div>

      <!-- RIGHT -->
      <div class="flex flex-col gap-[18px]">
        <div
          class="k-card overflow-hidden"
          style="border-color: var(--primary-border)"
        >
          <div
            class="flex items-center gap-3.5 px-5 py-[18px]"
            style="background: linear-gradient(90deg, color-mix(in oklab, var(--primary) 8%, transparent), transparent)"
          >
            <img
              src="/mascot/mascotRight.png"
              alt="Knecht"
              class="h-[52px] w-auto flex-none"
              style="filter: var(--drop-shadow-mascot)"
            >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <KStatusDot
                  :color="statusMeta.dot"
                  :pulse="statusMeta.pulse"
                  :size="6"
                />
                <span
                  class="k-mono text-[11px] uppercase tracking-[0.1em]"
                  :style="{ color: statusMeta.text }"
                >{{ statusMeta.label }}</span>
              </div>
              <p class="mt-1.5 text-[13.5px] leading-[1.35] text-(--text-toned)">
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
            <UButton
              size="xs"
              color="primary"
              variant="subtle"
              icon="i-lucide-save"
              label="Save"
              :loading="saving"
              @click="save"
            />
          </template>

          <div class="flex flex-col gap-4">
            <UFormField
              label="Site URL"
              :ui="{ label: 'k-label !text-(--text-dimmed)' }"
            >
              <UInput
                v-model="siteUrl"
                placeholder="https://example.test"
                size="sm"
                class="w-full"
              />
            </UFormField>

            <div>
              <div class="mb-2.5 flex items-center justify-between">
                <span class="k-label">Env variables</span>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-plus"
                  @click="addEnv"
                />
              </div>
              <div
                v-if="!envVars.length"
                class="k-mono text-[11.5px] text-(--text-dimmed)"
              >
                No variables yet.
              </div>
              <div
                v-else
                class="flex flex-col gap-2"
              >
                <div
                  v-for="(env, index) in envVars"
                  :key="index"
                  class="flex items-center gap-2"
                >
                  <UInput
                    v-model="env.key"
                    placeholder="KEY"
                    size="sm"
                    class="flex-1"
                  />
                  <UInput
                    v-model="env.value"
                    placeholder="value"
                    size="sm"
                    class="flex-1"
                  />
                  <UButton
                    color="error"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-trash-2"
                    aria-label="Remove"
                    @click="removeEnv(index)"
                  />
                </div>
              </div>
            </div>

            <div class="border-t border-(--border-muted) pt-3.5">
              <span class="k-label">Database dump</span>
              <div
                v-if="dumpName"
                class="mt-2.5 flex items-center gap-2"
              >
                <UIcon
                  name="i-lucide-database"
                  class="size-4 flex-none text-(--text-dimmed)"
                />
                <span class="k-mono flex-1 truncate text-[11.5px] text-(--text-muted)">{{ dumpName }}</span>
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
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
                size="xs"
                :loading="uploadingDump"
                @click="dumpInput?.click()"
              />
            </div>
          </div>
        </KPanel>

        <KPanel
          title="Triggers"
          icon="i-lucide-zap"
          accent="var(--accent-violet)"
        >
          <template #action>
            <span class="k-mono text-[11px] text-(--text-dimmed)">Planned</span>
          </template>
          <div class="flex flex-col gap-3">
            <div
              v-for="t in PLANNED_TRIGGERS"
              :key="t.name"
              class="flex items-center gap-3 opacity-70"
            >
              <KStepIcon
                :icon="t.icon"
                :size="28"
                :radius="7"
                color="var(--text-dimmed)"
              />
              <div class="min-w-0 flex-1">
                <div class="text-[13px] text-(--text-default)">
                  {{ t.name }}
                </div>
                <div class="k-mono text-[11px] text-(--text-dimmed)">
                  {{ t.sub }}
                </div>
              </div>
              <span class="relative h-[19px] w-[34px] flex-none rounded-full border border-(--border-default) bg-(--surface-accented)">
                <span class="absolute left-0.5 top-0.5 size-[13px] rounded-full bg-(--text-dimmed)" />
              </span>
            </div>
          </div>
        </KPanel>
      </div>
    </div>
  </div>
</template>
