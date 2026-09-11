<script setup lang="ts">
import { runWorkspacePath } from '#shared/utils/routes'

// Old-scheme links sit in published PR bodies, so /runs/:id must keep resolving.
// A page, not routeRules: see pages/index.vue.
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
