<script setup lang="ts">
// Not routeRules: on preview subdomains the proxy middleware intercepts first,
// which a global redirect would bypass.
await navigateTo('/projects', { replace: true })
</script>

<template>
  <div />
</template>
