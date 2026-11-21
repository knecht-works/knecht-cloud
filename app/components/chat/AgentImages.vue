<script setup lang="ts">
import { agentImageUrl } from '#shared/utils/agent-images'
import { ref } from 'vue'
import { UModal } from '#components'

const props = defineProps<{ sessionId: number, files: string[] }>()

const expanded = ref<string | null>(null)
</script>

<template>
  <div class="ml-6 flex flex-wrap gap-2">
    <button
      v-for="file in props.files"
      :key="file"
      type="button"
      class="cursor-zoom-in overflow-hidden rounded-md border border-muted hover:border-accented"
      aria-label="Open screenshot"
      @click="expanded = file"
    >
      <img
        :src="agentImageUrl(props.sessionId, file)"
        alt="Screenshot"
        loading="lazy"
        class="block max-h-48 w-auto max-w-80 object-contain"
      >
    </button>
    <UModal
      :open="expanded !== null"
      title="Screenshot"
      :ui="{ content: 'max-w-6xl bg-transparent shadow-none ring-0' }"
      @update:open="(value: boolean) => { if (!value) expanded = null }"
    >
      <template #content>
        <img
          v-if="expanded"
          :src="agentImageUrl(props.sessionId, expanded)"
          alt="Screenshot"
          class="mx-auto block max-h-[90vh] w-auto cursor-zoom-out rounded-md object-contain"
          @click="expanded = null"
        >
      </template>
    </UModal>
  </div>
</template>
