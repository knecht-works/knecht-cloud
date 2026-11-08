<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const token = computed(() => String(route.params.token))

const { data: invite, error: inviteError } = await useFetch(() => `/auth/invite/${token.value}`)
const githubTaken = route.query.error === 'username'
</script>

<template>
  <div class="k-card flex flex-col gap-6 overflow-hidden p-8">
    <template v-if="inviteError || !invite">
      <div>
        <h1 class="text-xl font-semibold text-highlighted">
          Invite not valid
        </h1>
        <p class="mt-1 text-sm text-muted">
          This invite link is invalid, was already used or has expired. Ask an owner for a new one.
        </p>
      </div>
      <UButton
        to="/login"
        color="neutral"
        block
      >
        Go to login
      </UButton>
    </template>

    <template v-else>
      <div>
        <h1 class="text-xl font-semibold text-highlighted">
          Join Knecht
        </h1>
        <p class="mt-1 text-sm text-muted">
          <template v-if="invite.invitedBy">
            @{{ invite.invitedBy }} invited you to this instance.
          </template>
          <template v-else>
            You are invited to this instance.
          </template>
        </p>
      </div>

      <UAlert
        v-if="githubTaken"
        color="error"
        variant="subtle"
        description="Your GitHub username is already taken here. Pick a username and password instead."
      />

      <KAuthForm
        :endpoint="`/auth/invite/${token}`"
        :github-url="invite.github ? `/auth/github?invite=${encodeURIComponent(token)}` : null"
        github-label="Join with GitHub"
        submit-label="Create account"
        new-account
      />
    </template>
  </div>
</template>
