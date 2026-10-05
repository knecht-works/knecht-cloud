<script setup lang="ts">
const id = Number(useRoute().params.id)

const { data: project } = await useFetch(`/api/projects/${id}`)

const base = `/projects/${id}/settings`
const SECTIONS = [
  { label: 'Environment', icon: 'i-lucide-database', to: base },
  { label: 'Agent', icon: 'i-lucide-sparkles', to: `${base}/agent` },
  { label: 'Integrations', icon: 'i-lucide-plug', to: `${base}/integrations` },
  { label: 'Advanced', icon: 'i-lucide-sliders-horizontal', to: `${base}/advanced` },
]
</script>

<template>
  <div v-if="project">
    <KProjectHeader
      :project="project"
      @run-started="runId => navigateTo({ path: `/projects/${id}`, query: { run: String(runId) } })"
    >
      <template #breadcrumb>
        <div class="flex min-w-0 items-center gap-2 text-dimmed">
          <NuxtLink
            to="/projects"
            class="k-mono text-xs transition-colors hover:text-muted"
          >
            Projects
          </NuxtLink>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-3"
          />
          <NuxtLink
            :to="`/projects/${id}`"
            class="k-mono truncate text-xs transition-colors hover:text-muted"
          >
            {{ project.fullName }}
          </NuxtLink>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-3"
          />
          <span class="k-mono text-xs text-muted">Settings</span>
        </div>
      </template>
    </KProjectHeader>
    <KProjectHero
      class="mb-6"
      :project="project"
    />

    <KSettingsNav :sections="SECTIONS">
      <NuxtPage />
    </KSettingsNav>
  </div>
</template>
