<script setup lang="ts">
// Runs live inside their project's workspace now, but /runs/:id must keep
// resolving forever: {{ run.url }} points here and is already published in
// PR bodies and commit messages. This page looks the run up and lands on its
// project with the run preselected; a deleted run falls back to the history.
// Done as a page (not routeRules) because the target depends on the run's
// project, and redirects must happen inside the Nuxt renderer on this host
// (see pages/index.vue).
const id = Number(useRoute().params.id)
const { data: run } = await useFetch(`/api/runs/${id}`)
await navigateTo(
  run.value ? `/projects/${run.value.projectId}?run=${id}` : '/runs',
  { replace: true },
)
</script>

<template>
  <div />
</template>
