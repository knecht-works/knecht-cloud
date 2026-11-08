<script setup lang="ts">
defineProps<{
  lastUsed?: boolean
}>()
</script>

<template>
  <UButton
    icon="i-simple-icons-github"
    color="neutral"
    block
    class="justify-start"
  >
    <slot />
    <template #trailing>
      <span class="ms-auto flex items-center gap-2">
        <KLastUsedBadge v-if="lastUsed" />
        <UIcon
          name="i-lucide-arrow-right"
          class="size-4"
        />
      </span>
    </template>
  </UButton>
</template>
