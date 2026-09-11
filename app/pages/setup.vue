<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
// Client-only: the endpoint's httpOnly CSRF-state cookie only reaches the
// browser on a real HTTP response; during SSR the Set-Cookie is dropped.
const { data: status } = await useFetch('/api/_setup/status', { server: false })

const setup = computed(() => (status.value && !status.value.configured ? status.value : null))

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
        class="h-32 w-auto drop-shadow-mascot"
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

      <p class="mt-6 text-2sm leading-relaxed text-muted text-center">
        This is the one time setup. Knecht creates its own GitHub App, this covers both login and repo access.
        Click below, confirm on GitHub, then install the app on the repos Knecht
        should manage.
      </p>

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
