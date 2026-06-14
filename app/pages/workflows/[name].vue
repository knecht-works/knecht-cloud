<script setup lang="ts">
const route = useRoute()
const toast = useToast()
const name = computed(() => decodeURIComponent(String(route.params.name)))

const { data: workflows } = await useFetch('/api/workflows', { default: () => [] })
const { data: projects } = await useFetch('/api/projects', {
  default: () => [],
  transform: rows => rows.map(p => ({ ...p, label: p.fullName })),
})

const workflow = computed(() => workflows.value?.find(w => w.name === name.value) ?? null)
const stepMetas = computed(() => (workflow.value?.steps ?? []).map(workflowStepMeta))

// The real, available step block types (mirrors the workflow schema). Read-only
// reference for now — the visual editor isn't wired to persistence yet.
const BLOCK_TYPES: { icon: string, kind: StepKind, label: string }[] = [
  { icon: 'i-lucide-play', kind: 'det', label: 'Boot project' },
  { icon: 'i-lucide-terminal', kind: 'det', label: 'Shell command' },
]

// ── Run the workflow against a project ───────────────────────────────────
const open = ref(false)
const selectedProject = ref()
const running = ref(false)

async function run() {
  if (!selectedProject.value || !workflow.value) return
  running.value = true
  try {
    const created = await $fetch('/api/runs', {
      method: 'POST',
      body: { projectId: selectedProject.value.id, workflow: workflow.value.name },
    })
    await navigateTo(`/runs/${created.id}`)
  }
  catch (e) {
    running.value = false
    toast.add({
      title: 'Failed to start run',
      description: (e as { data?: { statusMessage?: string } }).data?.statusMessage,
      color: 'error',
    })
  }
}
</script>

<template>
  <div>
    <div class="mb-3.5 flex items-center gap-2 text-(--text-dimmed)">
      <NuxtLink
        to="/workflows"
        class="k-mono text-xs transition-colors hover:text-(--text-muted)"
      >
        Workflows
      </NuxtLink>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3"
      />
      <span class="k-mono truncate text-xs text-(--text-muted)">{{ name }}</span>
    </div>

    <div
      v-if="!workflow"
      class="k-card flex flex-col items-center gap-3 px-6 py-14 text-center"
    >
      <UIcon
        name="i-lucide-workflow"
        class="size-7 text-(--text-dimmed)"
      />
      <p class="text-[13px] text-(--text-muted)">
        Workflow not found.
        <NuxtLink
          to="/workflows"
          class="text-(--text-primary) hover:underline"
        >Back to workflows</NuxtLink>
      </p>
    </div>

    <template v-else>
      <!-- Builder header -->
      <div class="mb-5 flex flex-wrap items-center justify-between gap-5">
        <div class="flex min-w-0 items-center gap-3.5">
          <KStepIcon
            icon="i-lucide-workflow"
            color="var(--text-primary)"
            :size="40"
            :radius="9"
          />
          <div>
            <h1 class="text-xl font-semibold tracking-[-0.02em] text-(--text-highlighted)">
              {{ workflow.name }}
            </h1>
            <div class="mt-1 flex items-center gap-3 text-(--text-dimmed)">
              <span class="k-mono text-[11.5px]">{{ stepMetas.length }} steps</span>
              <span>·</span>
              <span class="k-mono text-[11.5px] text-(--text-muted)">{{ workflow.description }}</span>
            </div>
          </div>
        </div>
        <div class="flex flex-none items-center gap-2.5">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-play"
            label="Test run"
            :disabled="!projects?.length"
            @click="open = true"
          />
          <UTooltip text="Editing isn't wired up yet">
            <UButton
              color="primary"
              label="Save"
              disabled
            />
          </UTooltip>
        </div>
      </div>

      <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_280px]">
        <!-- Step list -->
        <div>
          <!-- Trigger -->
          <div class="mb-3 flex gap-3.5">
            <div class="flex w-[30px] flex-none justify-center">
              <UIcon
                name="i-lucide-play"
                class="mt-1.5 size-[18px] text-(--text-dimmed)"
              />
            </div>
            <div class="flex flex-1 items-center gap-3.5 rounded-(--radius-lg) border border-(--border-default) bg-(--surface-muted) px-4 py-3.5">
              <KStepIcon
                icon="i-lucide-play"
                color="var(--text-toned)"
              />
              <div class="flex-1">
                <span class="k-label">Trigger</span>
                <div class="mt-0.5 whitespace-nowrap text-sm text-(--text-highlighted)">
                  Manual
                </div>
              </div>
              <span class="k-mono whitespace-nowrap text-[11px] text-(--text-dimmed)">started from the dashboard</span>
            </div>
          </div>

          <!-- Steps (real workflow definition) -->
          <div
            v-for="(s, i) in stepMetas"
            :key="i"
            class="flex gap-3.5"
          >
            <div class="flex w-[30px] flex-none flex-col items-center">
              <span class="k-mono grid size-[30px] flex-none place-items-center rounded-full border border-(--border-accented) bg-(--surface-muted) text-xs font-semibold text-(--text-muted)">{{ i + 1 }}</span>
              <span
                v-if="i < stepMetas.length - 1"
                class="my-1 w-0.5 flex-1 rounded-sm bg-(--border-default)"
                style="min-height: 18px"
              />
            </div>
            <div class="mb-3 flex flex-1 items-center gap-3 overflow-hidden rounded-(--radius-lg) border border-(--border-default) bg-(--surface-muted) px-4 py-3.5">
              <KStepIcon
                :icon="s.icon"
                :color="STEP_KIND_COLOR[s.kind]"
              />
              <div class="min-w-0 flex-1">
                <div class="text-[14.5px] font-medium text-(--text-highlighted)">
                  {{ s.label }}
                </div>
                <div class="k-mono mt-0.5 truncate text-[12px] text-(--text-muted)">
                  {{ s.detail }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Available block types (reference) -->
        <div class="lg:sticky lg:top-0">
          <div class="k-card overflow-hidden">
            <div class="border-b border-(--border-muted) px-4 py-3.5">
              <span class="k-mono text-[11.5px] uppercase tracking-[0.1em] text-(--text-toned)">Step types</span>
            </div>
            <div class="flex flex-col gap-2 p-3.5">
              <div
                v-for="b in BLOCK_TYPES"
                :key="b.label"
                class="flex items-center gap-2.5 rounded-(--radius-md) border border-(--border-default) bg-(--surface-base) px-3 py-2.5"
              >
                <KStepIcon
                  :icon="b.icon"
                  :color="STEP_KIND_COLOR[b.kind]"
                  :size="26"
                  :radius="6"
                />
                <span class="text-[12.5px] text-(--text-toned)">{{ b.label }}</span>
              </div>
              <p class="k-mono mt-1 px-1 text-[11px] leading-[1.5] text-(--text-dimmed)">
                Workflows are defined in YAML for now. A visual editor is coming.
              </p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <UModal
      v-model:open="open"
      title="Test run"
      description="Pick a project to run this workflow against."
    >
      <template #body>
        <div class="space-y-4">
          <USelectMenu
            v-model="selectedProject"
            :items="projects ?? []"
            placeholder="Select a project…"
            icon="i-lucide-folder-git-2"
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
              color="primary"
              icon="i-lucide-play"
              label="Run"
              :loading="running"
              :disabled="!selectedProject"
              @click="run"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
