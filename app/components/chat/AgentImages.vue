<script setup lang="ts">
import { agentImageUrl } from '#shared/utils/agent-images'
import { ref } from 'vue'
import { UModal } from '#components'

const props = defineProps<{ sessionId: number, files: string[], large?: boolean }>()

const expanded = ref<string | null>(null)
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
      @click="expanded = file"
    >
      <img
        :src="agentImageUrl(props.sessionId, file)"
        alt="Screenshot"
        loading="lazy"
        class="block w-auto rounded-md border border-muted object-contain group-hover:border-accented"
        :class="props.large ? 'h-64 max-w-full' : 'max-h-24 max-w-48'"
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
