<script setup lang="ts">
// Home redirects to the project overview. Done here (not via routeRules) so it
// only fires once the request reaches the Nuxt renderer — on preview subdomains
// the preview proxy middleware intercepts first, which a global routeRules
// redirect would bypass (sending the iframe to /projects → 404 in the app).
await navigateTo('/projects', { replace: true })
</script>

<template>
  <div />
</template>
