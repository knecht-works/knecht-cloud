<script setup lang="ts">
const id = Number(useRoute().params.id)

const { data: project } = await useFetch(`/api/projects/${id}`)

const { data: integrations, status } = useFetch('/api/integrations', { default: () => [], lazy: true })
const linkableIntegrations = computed(() =>
  integrations.value.filter(i => i.configured).flatMap(i => i.link ? [{ ...i, link: i.link }] : []))
</script>

<template>
  <div
    v-if="project"
    class="flex flex-col gap-4.5"
  >
    <KProjectLinkPanel
      v-for="i in linkableIntegrations"
      :key="i.id"
      :project-id="id"
      :integration="i"
      :model-value="project.links[i.id] ?? null"
    />

    <div
      v-if="status === 'success' && !linkableIntegrations.length"
      class="k-card flex flex-col items-center gap-3 px-6 py-14 text-center"
    >
      <UIcon
        name="i-lucide-plug"
        class="size-7 text-dimmed"
      />
      <p class="text-2sm text-muted">
        No integration to link yet. Connect Jira, Linear or Plane in
        <NuxtLink
          to="/settings/integrations"
          class="text-toned underline underline-offset-2 hover:text-highlighted"
        >Settings → Integrations</NuxtLink>.
      </p>
    </div>
  </div>
</template>
