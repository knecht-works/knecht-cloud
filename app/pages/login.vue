<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
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
        Boot. Fix. Test. Fully automatic.
      </p>
    </div>

    <UAlert
      v-if="route.query.error"
      color="error"
      variant="subtle"
      class="mt-6"
      title="Login failed"
      description="Please try again."
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

    <p class="k-mono mt-4 flex items-center justify-center gap-1.5 text-[11px] text-(--text-dimmed)">
    </p>
  </div>
</template>
