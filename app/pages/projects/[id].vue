<script setup lang="ts">
import { liveTopics } from '#shared/utils/live-topics'
import { useRoute, navigateTo } from '#imports'
import { useProject } from '~/composables/useProjects'
import { invalidate } from '~/composables/useLiveTopics'
import KProjectHeader from '~/components/KProjectHeader.vue'
import { NuxtPage } from '#components'

const id = Number(useRoute().params.id)

const { data: project } = await useProject(id)

async function onRunStarted(runId: number) {
  await invalidate(liveTopics.runs)
  await navigateTo({ path: `/projects/${id}/sessions`, query: { run: String(runId) } })
}
</script>

<template>
  <div v-if="project">
    <KProjectHeader
      class="mb-5"
      :project="project"
      @run-started="onRunStarted"
    />
    <NuxtPage />
  </div>
</template>
