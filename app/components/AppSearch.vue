<script setup lang="ts">
// Global dashboard search for the top bars: a ⌘K-triggered command palette over
// projects, workflows and triggers. Same bar on every screen.
const { data: projects } = useFetch('/api/projects', { default: () => [], lazy: true })
const { data: workflows } = useFetch('/api/workflows', { default: () => [], lazy: true })
const { data: triggers } = useFetch('/api/triggers', { default: () => [], lazy: true })

const open = ref(false)
defineShortcuts({
  meta_k: () => { open.value = true },
})

function close() {
  open.value = false
}

const groups = computed(() => [
  {
    id: 'projects',
    label: 'Projects',
    items: (projects.value ?? []).map(p => ({
      label: p.fullName,
      suffix: frameworkMeta(p.framework).label,
      icon: 'i-lucide-folder-git-2',
      to: `/projects/${p.id}`,
      onSelect: close,
    })),
  },
  {
    id: 'workflows',
    label: 'Workflows',
    items: (workflows.value ?? []).map(w => ({
      label: w.name,
      suffix: w.description ?? undefined,
      icon: 'i-lucide-workflow',
      to: `/workflows/${encodeURIComponent(w.name)}`,
      onSelect: close,
    })),
  },
  {
    id: 'triggers',
    label: 'Triggers',
    items: (triggers.value ?? []).map(t => ({
      label: t.event,
      suffix: `${t.kind} · ${t.workflow}`,
      icon: 'i-lucide-zap',
      to: `/workflows/${encodeURIComponent(t.workflow)}`,
      onSelect: close,
    })),
  },
])
</script>

<template>
  <UButton
    color="neutral"
    variant="outline"
    class="hidden sm:flex"
    @click="() => { open = true }"
  >
    <UIcon
      name="i-lucide-search"
      class="size-4 text-(--text-dimmed)"
    />
    Search
    <span class="ml-4 flex items-center gap-1">
      <UKbd value="meta" />
      <UKbd value="k" />
    </span>
  </UButton>

  <UModal v-model:open="open">
    <template #content>
      <UCommandPalette
        :groups="groups"
        placeholder="Search projects, workflows, triggers…"
        class="h-80"
        @update:open="open = $event"
      />
    </template>
  </UModal>
</template>
