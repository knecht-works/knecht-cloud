<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()

// An unconfigured instance has nothing to sign in to (the OAuth flow needs the
// GitHub App from setup), so land visitors on the setup page directly.
// Client-only for the same reason as in setup.vue: the endpoint's CSRF-state
// cookie only survives a real HTTP response.
const { data: setupStatus } = await useFetch('/api/_setup/status', { server: false })
watch(setupStatus, (s) => {
  if (s && !s.configured) navigateTo('/setup', { replace: true })
}, { immediate: true })

// `forbidden` = a valid GitHub login that isn't on this instance's allowlist;
// anything else is a generic OAuth failure.
const error = computed(() => {
  if (!route.query.error) return null
  return route.query.error === 'forbidden'
    ? { title: 'Access denied', description: 'This GitHub account isn’t a member of this Knecht instance. Ask the owner to invite you.' }
    : { title: 'Login failed', description: 'Please try again.' }
})
</script>

<template>
  <div class="k-card overflow-hidden p-8">
    <div class="flex flex-col items-center text-center">
      <img
        src="/mascot/mascotMain.png"
        alt="Knecht"
        class="h-32 w-auto drop-shadow-mascot"
      >
      <p class="mt-4 text-2sm text-muted">
        Boot. Fix. Test. Fully automatic.
      </p>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      class="mt-6"
      :title="error.title"
      :description="error.description"
    />

    <UButton
      to="/auth/github"
      external
      icon="i-simple-icons-github"
      color="neutral"
      size="lg"
      block
      class="mt-6"
    >
      Sign in with GitHub
    </UButton>

    <p class="k-mono mt-4 flex items-center justify-center gap-1.5 text-2xs text-dimmed" />
  </div>
</template>
