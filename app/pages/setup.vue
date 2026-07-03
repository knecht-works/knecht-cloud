<script setup lang="ts">
// First-run setup. Public page (see app/middleware/auth.global.ts): before a
// GitHub App exists nobody can log in, so this must be reachable logged-out. It
// creates the app via GitHub's manifest flow — one click, no env vars — and
// GitHub hands the credentials back to /setup/callback.
definePageMeta({ layout: 'auth' })

const route = useRoute()
// Client-only: the endpoint sets an httpOnly CSRF-state cookie, which only
// reaches the browser on a real HTTP response. During SSR useFetch calls the
// route through an internal event whose Set-Cookie is dropped — the browser
// would then have the state in the form URL but no cookie, failing the callback.
const { data: status } = await useFetch('/api/_setup/status', { server: false })

// The create-app payload, or null once configured — narrows the union so the
// template can reach state/manifest.
const setup = computed(() => (status.value && !status.value.configured ? status.value : null))

// Optional GitHub org to own the app. A private app can only be installed on the
// account that owns it, so to manage an org's repos the app must be created under
// that org. Empty → the personal account.
const org = ref('')
const actionUrl = computed(() => {
  if (!setup.value) return ''
  const owner = org.value.trim()
  const base = owner
    ? `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new`
    : 'https://github.com/settings/apps/new'
  return `${base}?state=${setup.value.state}`
})

const errorMessage = computed(() => {
  if (status.value?.configured) return null
  switch (route.query.error) {
    case 'state': return 'Setup session expired — please try again.'
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
        class="h-28 w-auto"
        style="filter: var(--drop-shadow-mascot)"
      >
      <KLogo
        :height="30"
        class="mt-5"
      />
      <p class="mt-2 text-[13.5px] text-(--text-muted)">
        One-time setup — connect Knecht to GitHub.
      </p>
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

      <p class="mt-6 text-[13px] leading-relaxed text-(--text-muted)">
        Knecht creates its own GitHub App — this covers both login and repo access.
        Click below, confirm on GitHub, then install the app on the repos Knecht
        should manage. No tokens or env variables to copy.
      </p>

      <form
        v-if="setup"
        :action="actionUrl"
        method="post"
        class="mt-6 space-y-3"
      >
        <UFormField
          label="GitHub organization"
          hint="optional"
          description="To manage an org's repos, create the app under that org. Leave empty for your personal account."
        >
          <UInput
            v-model="org"
            placeholder="e.g. knecht"
            class="w-full"
          />
        </UFormField>
        <input
          type="hidden"
          name="manifest"
          :value="JSON.stringify(setup.manifest)"
        >
        <UButton
          type="submit"
          icon="i-simple-icons-github"
          color="neutral"
          size="lg"
          block
        >
          Create GitHub App
        </UButton>
      </form>
    </template>
  </div>
</template>
