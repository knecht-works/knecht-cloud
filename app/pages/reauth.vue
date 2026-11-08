<script setup lang="ts">
definePageMeta({ layout: false })

// The GitHub confirmation runs in a popup so the action waiting in the opener survives it.
const result = useRoute().query.reauth

onMounted(() => {
  if (!window.opener) return navigateTo('/')
  window.opener.postMessage({ type: 'knecht:reauth', result }, window.location.origin)
  window.close()
})
</script>

<template>
  <div />
</template>
