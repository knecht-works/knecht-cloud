<script setup lang="ts">
import { safeRedirectPath } from '#shared/utils/account'
import { definePageMeta } from '#app/composables/pages'
import { useRoute, useFetch, navigateTo } from '#app'
import { watch, computed } from 'vue'
import KAuthForm from '~/components/KAuthForm.vue'
import { UAlert } from '#components'

definePageMeta({ layout: 'auth' })

const route = useRoute()

// Client-only for the same reason as in setup.vue (CSRF-state cookie).
const { data: setupStatus } = await useFetch('/api/_setup/status', { server: false })
watch(setupStatus, (s) => {
  if (s && !s.configured) navigateTo('/setup', { replace: true })
}, { immediate: true })

const redirect = computed(() => safeRedirectPath(route.query.redirect) ?? undefined)

const error = computed(() => {
  if (!route.query.error) return null
  return route.query.error === 'forbidden'
    ? { title: 'Access denied', description: 'This GitHub account isn’t a member of this Knecht instance. Ask the owner to invite you.' }
    : { title: 'Login failed', description: 'Please try again.' }
})
</script>

<template>
  <div class="k-card flex flex-col gap-6 overflow-hidden p-8">
    <div>
      <h1 class="text-xl font-semibold text-highlighted">
        Welcome back
      </h1>
      <p class="mt-1 text-sm text-muted">
        Sign in to your Knecht instance.
      </p>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :title="error.title"
      :description="error.description"
    />
    <div class="flex flex-col gap-3">
      <KAuthForm
        endpoint="/auth/password"
        :github-url="redirect ? `/auth/github?redirect=${encodeURIComponent(redirect)}` : '/auth/github'"
        :redirect="redirect"
        github-label="Sign in with GitHub"
        submit-label="Sign in"
      />
      <p class="text-xs text-dimmed">
        Forgot your password? Ask an owner for a reset link.
      </p>
    </div>
  </div>
</template>
