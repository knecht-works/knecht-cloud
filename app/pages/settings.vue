<script setup lang="ts">
// Settings shell: a section nav on the left, the active section's page on the
// right (nested routes under /settings). Each section is its own small page
// with its own data and save indicator.
const route = useRoute()

const SECTIONS = [
  { label: 'Access', icon: 'i-lucide-users', to: '/settings' },
  { label: 'Agent', icon: 'i-lucide-sparkles', to: '/settings/agent' },
  { label: 'Environments', icon: 'i-lucide-box', to: '/settings/environments' },
  { label: 'Jira', icon: 'i-simple-icons-jira', to: '/settings/jira' },
  { label: 'Advanced', icon: 'i-lucide-sliders-horizontal', to: '/settings/advanced' },
]

function isActive(to: string) {
  return to === '/settings' ? route.path === '/settings' : route.path.startsWith(to)
}
</script>

<template>
  <div>
    <KTopBar
      title="Settings"
      sub="Access, agent and environment configuration."
    >
      <template #actions>
        <AppSearch />
      </template>
    </KTopBar>

    <div class="flex flex-col gap-5 lg:flex-row lg:gap-8">
      <!-- On small screens the nav is a horizontal strip above the section;
           from lg on it is a sticky column like the app sidebar. -->
      <nav class="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-4 lg:w-52 lg:flex-none lg:flex-col lg:self-start lg:overflow-visible lg:pb-0">
        <NuxtLink
          v-for="s in SECTIONS"
          :key="s.to"
          :to="s.to"
          class="relative flex flex-none items-center gap-2.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors"
          :class="isActive(s.to)
            ? 'border-default bg-(--surface-glass) text-highlighted'
            : 'border-transparent text-muted hover:text-toned'"
        >
          <span
            v-if="isActive(s.to)"
            class="absolute inset-y-2 -left-px hidden w-0.5 rounded-sm bg-primary lg:block"
            style="box-shadow: 0 0 8px var(--primary)"
          />
          <UIcon
            :name="s.icon"
            class="size-4 flex-none"
            :class="isActive(s.to) ? 'text-primary' : 'text-dimmed'"
          />
          {{ s.label }}
        </NuxtLink>
      </nav>

      <div class="min-w-0 flex-1">
        <NuxtPage />
      </div>
    </div>
  </div>
</template>
