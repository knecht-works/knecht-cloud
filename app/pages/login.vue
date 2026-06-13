<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
</script>

<template>
  <UCard class="w-full max-w-md">
    <template #header>
      <h1 class="text-lg font-bold">
        Knecht
      </h1>
    </template>

    <UAlert
      v-if="route.query.error"
      color="error"
      variant="subtle"
      class="mb-4"
      title="Login fehlgeschlagen"
      description="Bitte versuche es erneut."
    />
    <p class="mb-4 text-muted">
      Bitte mit GitHub anmelden, um fortzufahren.
    </p>
    <UButton
      to="/auth/github"
      external
      icon="i-simple-icons-github"
      block
    >
      Mit GitHub anmelden
    </UButton>
  </UCard>
</template>
