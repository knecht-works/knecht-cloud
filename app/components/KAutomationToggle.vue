<script setup lang="ts">
defineProps<{
  enabled: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <span class="flex flex-none">
    <UTooltip :text="enabled ? 'Automation on, click to pause' : 'Automation paused, click to enable'">
      <KToggle
        :active="enabled"
        :aria-label="enabled ? 'Pause automation' : 'Enable automation'"
        @toggle="emit('toggle')"
      />
    </UTooltip>
  </span>
</template>
