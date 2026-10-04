<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()

const { data: projects } = useFetch('/api/projects', { default: () => [], lazy: true })
const { data: workflows } = useFetch('/api/workflows', { default: () => [], lazy: true })
const { data: integrations } = useFetch('/api/integrations', { default: () => [], lazy: true })

const SETTINGS = [
  { label: 'Access', suffix: 'Members, invite, owner, sign out', icon: 'i-lucide-users', to: '/settings' },
  { label: 'Agent', suffix: 'Provider, API key, default model, subtask model', icon: 'i-lucide-sparkles', to: '/settings/agent' },
  { label: 'Instructions', suffix: 'Agent instructions', icon: 'i-lucide-list-checks', to: '/settings/agent' },
  { label: 'Environments', suffix: 'Live, stopped, archived, deleted, parallel runs', icon: 'i-lucide-box', to: '/settings/advanced' },
  { label: 'Automatic updates', suffix: 'Update schedule', icon: 'i-lucide-arrow-up-circle', to: '/settings/advanced' },
  { label: 'Remote access', suffix: 'SSH target', icon: 'i-lucide-terminal', to: '/settings/advanced' },
]

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
    id: 'settings',
    label: 'Settings',
    items: [
      ...SETTINGS,
      ...(integrations.value ?? []).filter(i => i.connectionForm).map(i => ({
        label: i.name,
        suffix: 'Integration',
        icon: 'i-lucide-plug',
        to: '/settings/integrations',
      })),
    ].map(item => ({ ...item, onSelect: close })),
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
      class="flex w-full cursor-pointer items-center gap-3 rounded-md border border-default bg-(--surface-inset) py-2.5 text-sm text-dimmed transition-colors hover:border-accented hover:text-muted"
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
          <UKbd
            value="meta"
            size="sm"
          />
          <UKbd
            value="k"
            size="sm"
          />
        </span>
      </template>
    </button>
  </UTooltip>

  <UModal v-model:open="open">
    <template #content>
      <UCommandPalette
        :groups="groups"
        placeholder="Search projects, workflows and settings…"
        class="h-80"
        @update:open="open = $event"
      />
    </template>
  </UModal>
</template>
