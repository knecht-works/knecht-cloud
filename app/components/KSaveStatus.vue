<script setup lang="ts">
// The autosave indicator the settings panels share: nothing while idle, then
// Saving…/Saved, and the error text when a save was refused (validation or
// server), so the reason is visible right in the panel header.
defineProps<{
  state: 'idle' | 'saving' | 'saved' | 'error'
  errorText?: string
}>()
</script>

<template>
  <span
    v-if="state !== 'idle'"
    class="k-mono text-2xs"
    :class="state === 'error' ? 'text-error' : 'text-primary'"
  >
    {{ state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : (errorText || 'Not saved') }}
  </span>
</template>
