<script setup lang="ts">
const toast = useToast()

const { data: projects, refresh } = await useFetch('/api/projects')
// Runs power the per-project live status, counts and the metric row.
const { data: runs } = await useFetch('/api/runs', { default: () => [] })

// Newest run per project (the list is already newest-first) + a run count.
const runsByProject = computed(() => {
  const latest = new Map<number, (typeof runs.value)[number]>()
  const counts = new Map<number, number>()
  for (const r of runs.value ?? []) {
    counts.set(r.projectId, (counts.get(r.projectId) ?? 0) + 1)
    if (!latest.has(r.projectId)) latest.set(r.projectId, r)
  }
  return { latest, counts }
})

const metrics = computed(() => {
  const list = runs.value ?? []
  return {
    projects: projects.value?.length ?? 0,
    active: list.filter(r => r.status === 'running' || r.status === 'queued').length,
    previews: list.filter(r => r.envState === 'up').length,
    runs: list.length,
  }
})

const activeFw = ref<string | null>(null)

// Distinct framework labels present, for the filter pills.
const frameworks = computed(() => {
  const labels = new Set<string>()
  for (const p of projects.value ?? []) {
    if (p.framework) labels.add(frameworkMeta(p.framework).label)
  }
  return [...labels].sort()
})

const filtered = computed(() =>
  (projects.value ?? []).filter(p =>
    !activeFw.value || frameworkMeta(p.framework).label === activeFw.value,
  ),
)

// ── Search (⌘K command palette) ──────────────────────────────────────────
// Fuzzy search across all projects; selecting one jumps to its detail page.
const searchOpen = ref(false)
defineShortcuts({
  meta_k: () => { searchOpen.value = true },
})

const searchGroups = computed(() => [{
  id: 'projects',
  label: 'Projects',
  items: (projects.value ?? []).map(p => ({
    label: p.fullName,
    suffix: frameworkMeta(p.framework).label,
    icon: 'i-lucide-folder-git-2',
    to: `/projects/${p.id}`,
    onSelect: () => { searchOpen.value = false },
  })),
}])

// ── Connect a GitHub repo ────────────────────────────────────────────────
const open = ref(false)
const selected = ref()
const connecting = ref(false)

const { data: repos, status: reposStatus, execute: loadRepos } = useFetch('/api/github/repos', {
  immediate: false,
  transform: rows => rows.map(r => ({ ...r, label: r.fullName, description: r.description ?? undefined })),
})

watch(open, (isOpen) => {
  if (isOpen && !repos.value) loadRepos()
})

async function connect() {
  if (!selected.value) return
  connecting.value = true
  try {
    await $fetch('/api/projects', {
      method: 'POST',
      body: {
        githubId: selected.value.githubId,
        owner: selected.value.owner,
        name: selected.value.name,
        fullName: selected.value.fullName,
        defaultBranch: selected.value.defaultBranch,
        private: selected.value.private,
        cloneUrl: selected.value.cloneUrl,
      },
    })
    toast.add({ title: 'Project connected', color: 'success' })
    open.value = false
    selected.value = undefined
    await refresh()
  }
  catch (e) {
    toast.add({
      title: 'Failed to connect',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
  finally {
    connecting.value = false
  }
}
</script>

<template>
  <div>
    <KTopBar title="Projects">
      <template #actions>
        <UButton
          color="neutral"
          variant="subtle"
          class="hidden sm:flex"
          @click="searchOpen = true"
        >
          <UIcon
            name="i-lucide-search"
            class="size-4 text-(--text-dimmed)"
          />
          <span class="pr-6 text-(--text-dimmed)">Search projects</span>
          <span class="flex items-center gap-1">
            <UKbd value="meta" />
            <UKbd value="k" />
          </span>
        </UButton>
        <UButton
          icon="i-lucide-plus"
          label="New project"
          color="primary"
          @click="open = true"
        />
      </template>
    </KTopBar>

    <div class="mb-[22px] grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KMetric
        :value="metrics.projects"
        label="Projects"
      />
      <KMetric
        :value="metrics.active"
        label="Active runs"
        accent="var(--accent-orange)"
      />
      <KMetric
        :value="metrics.previews"
        label="Previews online"
        accent="var(--primary)"
      />
      <KMetric
        :value="metrics.runs"
        label="Total runs"
      />
    </div>

    <div class="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <span class="k-label">Active projects</span>
      <div
        v-if="frameworks.length"
        class="flex flex-wrap gap-2"
      >
        <button
          type="button"
          class="k-mono rounded-full px-2.5 py-1 text-[11.5px] transition-colors"
          :class="activeFw === null
            ? 'border border-(--border-default) bg-(--surface-glass) text-(--text-muted)'
            : 'border border-transparent text-(--text-dimmed) hover:text-(--text-muted)'"
          @click="activeFw = null"
        >
          All
        </button>
        <button
          v-for="f in frameworks"
          :key="f"
          type="button"
          class="k-mono rounded-full px-2.5 py-1 text-[11.5px] transition-colors"
          :class="activeFw === f
            ? 'border border-(--border-default) bg-(--surface-glass) text-(--text-muted)'
            : 'border border-transparent text-(--text-dimmed) hover:text-(--text-muted)'"
          @click="activeFw = f"
        >
          {{ f }}
        </button>
      </div>
      <span
        v-else
        class="k-mono text-[11.5px] text-(--text-dimmed)"
      >{{ filtered.length }} of {{ projects?.length ?? 0 }}</span>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <ProjectCard
        v-for="p in filtered"
        :id="p.id"
        :key="p.id"
        :full-name="p.fullName"
        :default-branch="p.defaultBranch"
        :private="p.private"
        :framework="p.framework"
        :framework-version="p.frameworkVersion"
        :latest="runsByProject.latest.get(p.id) ?? null"
        :runs-count="runsByProject.counts.get(p.id) ?? 0"
      />

      <button
        type="button"
        class="flex h-full min-h-[180px] flex-col items-center justify-center gap-3.5 rounded-(--radius-lg) border border-dashed border-(--border-accented) p-6 text-center transition-colors hover:bg-(--surface-glass)"
        @click="open = true"
      >
        <span class="grid size-12 place-items-center rounded-xl border border-(--border-accented) bg-(--surface-muted) text-(--text-primary)">
          <UIcon
            name="i-lucide-plus"
            class="size-6"
          />
        </span>
        <div>
          <div class="text-sm font-medium text-(--text-toned)">
            Connect a new project
          </div>
          <div class="mx-auto mt-1 max-w-[200px] text-[12.5px] text-(--text-dimmed)">
            A GitHub repo with DDEV
          </div>
        </div>
      </button>
    </div>

    <UModal v-model:open="searchOpen">
      <template #content>
        <UCommandPalette
          :groups="searchGroups"
          placeholder="Search projects…"
          class="h-80"
          @update:open="searchOpen = $event"
        />
      </template>
    </UModal>

    <UModal
      v-model:open="open"
      title="Connect a GitHub repo"
    >
      <template #body>
        <div class="space-y-4">
          <USelectMenu
            v-model="selected"
            :items="repos ?? []"
            :loading="reposStatus === 'pending'"
            placeholder="Select a repo…"
            icon="i-simple-icons-github"
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
              label="Connect"
              color="primary"
              :loading="connecting"
              :disabled="!selected"
              @click="connect"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
