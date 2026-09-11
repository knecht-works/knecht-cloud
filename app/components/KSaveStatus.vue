<script setup lang="ts">
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
