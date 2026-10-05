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
        <UBreadcrumb :items="[{ label: 'Projects', to: '/projects' }, { label: project.fullName, to: `/projects/${id}` }, { label: 'Settings' }]">
          <template #separator>
            <span class="k-mono text-xs text-dimmed">/</span>
          </template>
        </UBreadcrumb>
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
