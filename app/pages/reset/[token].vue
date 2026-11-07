<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const token = computed(() => String(route.params.token))

const { data: reset, error: resetError } = await useFetch(() => `/auth/reset/${token.value}`)
</script>

<template>
  <div class="k-card flex flex-col gap-6 overflow-hidden p-8">
    <template v-if="resetError || !reset">
      <div>
        <h1 class="text-xl font-semibold text-highlighted">
          Reset link not valid
        </h1>
        <p class="mt-1 text-sm text-muted">
          This reset link is invalid, was already used or has expired. Ask an owner for a new one.
        </p>
      </div>
      <UButton
        to="/login"
        color="neutral"
        size="lg"
        block
      >
        Go to login
      </UButton>
    </template>

    <template v-else>
      <div>
        <h1 class="text-xl font-semibold text-highlighted">
          Set a new password
        </h1>
        <p class="mt-1 text-sm text-muted">
          You are signed in right after.
        </p>
      </div>

      <KAuthForm
        :endpoint="`/auth/reset/${token}`"
        :github-url="null"
        github-label=""
        submit-label="Set password"
        new-account
        :fixed-username="reset.username"
      />
    </template>
  </div>
</template>
