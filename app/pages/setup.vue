<script setup lang="ts">
// First-run setup. Public page (see app/middleware/auth.global.ts): before a
// GitHub App exists nobody can log in, so this must be reachable logged-out. It
// creates the app via GitHub's manifest flow (one click, no env vars), and
// GitHub hands the credentials back to /setup/callback.
definePageMeta({ layout: 'auth' })

const route = useRoute()
// Client-only: the endpoint sets an httpOnly CSRF-state cookie, which only
// reaches the browser on a real HTTP response. During SSR useFetch calls the
// route through an internal event whose Set-Cookie is dropped: the browser
// would then have the state in the form URL but no cookie, failing the callback.
const { data: status } = await useFetch('/api/_setup/status', { server: false })

// The create-app payload, or null once configured: narrows the union so the
// template can reach state/manifest.
const setup = computed(() => (status.value && !status.value.configured ? status.value : null))

// Created under the operator's personal account. The app is public (see
// server/api/_setup/status.get.ts), so it can still be installed on any org's
// repos afterwards: no need to own it there. Creating it personally also makes
// the manifest's `owner.login` the operator, who /setup/callback claims as the
// instance owner.
const actionUrl = computed(() =>
  setup.value ? `https://github.com/settings/apps/new?state=${setup.value.state}` : '',
)

const errorMessage = computed(() => {
  if (status.value?.configured) return null
  switch (route.query.error) {
    case 'state': return 'Setup session expired, please try again.'
    case 'conversion': return 'GitHub could not create the app. Please try again.'
    default: return null
  }
})
</script>

<template>
  <div class="k-card overflow-hidden p-8">
    <div class="flex flex-col items-center text-center">
      <img
        src="/mascot/mascotMain.png"
        alt="Knecht"
        class="h-32 w-auto"
        style="filter: var(--drop-shadow-mascot)"
      >
    </div>

    <template v-if="status?.configured">
      <UAlert
        color="success"
        variant="subtle"
        class="mt-6"
        title="Already set up"
        description="This instance is already connected to a GitHub App."
      />
      <UButton
        to="/login"
        color="neutral"
        size="lg"
        block
        class="mt-6"
      >
        Go to login
      </UButton>
    </template>

    <template v-else>
      <UAlert
        v-if="errorMessage"
        color="error"
        variant="subtle"
        class="mt-6"
        title="Setup failed"
        :description="errorMessage"
      />

      <p class="mt-6 text-[13px] leading-relaxed text-(--text-muted) text-center">
        This is the one time setup. Knecht creates its own GitHub App, this covers both login and repo access.
        Click below, confirm on GitHub, then install the app on the repos Knecht
        should manage.
      </p>

      <!-- Rendered from the first paint (not gated behind the client-only fetch)
           so the button never pops in: it just sits in a loading state until the
           manifest + CSRF state have loaded, then enables. -->
      <form
        :action="actionUrl"
        method="post"
        class="mt-6"
      >
        <input
          type="hidden"
          name="manifest"
          :value="setup ? JSON.stringify(setup.manifest) : ''"
        >
        <UButton
          type="submit"
          icon="i-simple-icons-github"
          color="neutral"
          size="lg"
          block
          :loading="!setup"
          :disabled="!setup"
        >
          Create GitHub App
        </UButton>
      </form>
    </template>
  </div>
</template>
