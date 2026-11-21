<script setup lang="ts">
import { agentImageUrl } from '#shared/utils/agent-images'
import { CHAT_IMAGES } from '~/utils/chat'
import { inject } from 'vue'

const props = defineProps<{ files: string[], large?: boolean }>()

const images = inject(CHAT_IMAGES)!
</script>

<template>
  <div
    class="flex-wrap gap-2"
    :class="props.large ? 'inline-flex align-top' : 'flex'"
  >
    <button
      v-for="file in props.files"
      :key="file"
      type="button"
      class="group cursor-zoom-in"
      aria-label="Open screenshot"
      @click="images.open(file)"
    >
      <img
        :src="agentImageUrl(images.sessionId, file)"
        alt="Screenshot"
        loading="lazy"
        class="block w-auto rounded-md border border-muted object-contain group-hover:border-accented"
        :class="props.large ? 'h-64 max-w-full' : 'max-h-24 max-w-48'"
      >
    </button>
  </div>
</template>
