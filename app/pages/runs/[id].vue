<script setup lang="ts">
import { runWorkspacePath } from '#shared/utils/routes'

// Old-scheme run links: /runs/:id must keep resolving ({{ run.url }} used to
// point here and such links sit in published PR bodies and commit messages).
// This page looks the run up and lands on its project with the run
// preselected; a deleted run falls back to the history.
// Done as a page (not routeRules) because the target depends on the run's
// project, and redirects must happen inside the Nuxt renderer on this host
// (see pages/index.vue).
const id = Number(useRoute().params.id)
const { data: run } = await useFetch(`/api/runs/${id}`)
await navigateTo(
  run.value ? runWorkspacePath(run.value.projectId, id) : '/runs',
  { replace: true },
)
</script>

<template>
  <div />
</template>
