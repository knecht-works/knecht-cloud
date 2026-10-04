<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()

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
      to: `/workflows/${w.id}`,
      onSelect: close,
    })),
  },
  {
    id: 'triggers',
    label: 'Triggers',
    items: (triggers.value ?? []).map(t => ({
      label: t.event,
      suffix: `${triggerSourceMeta(t.source).label} · ${t.workflowName}`,
      icon: 'i-lucide-zap',
      to: `/workflows/${t.workflowId}`,
      onSelect: close,
    })),
  },
])
</script>

<template>
  <UTooltip
    text="Search"
    :kbds="['meta', 'k']"
    :disabled="!collapsed"
    :content="{ side: 'right' }"
  >
    <button
      type="button"
      aria-label="Search"
      class="flex w-full cursor-pointer items-center gap-3 rounded-md border border-default bg-(--surface-muted) py-2 text-sm text-muted transition-colors hover:text-toned"
      :class="collapsed ? 'justify-center px-0' : 'px-3'"
      @click="() => { open = true }"
    >
      <UIcon
        name="i-lucide-search"
        class="size-4.5 flex-none text-dimmed"
      />
      <template v-if="!collapsed">
        Search
        <span class="ml-auto flex items-center gap-1">
          <UKbd value="meta" />
          <UKbd value="k" />
        </span>
      </template>
    </button>
  </UTooltip>

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
