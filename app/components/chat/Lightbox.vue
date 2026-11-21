<script setup lang="ts">
import { agentImageUrl } from '#shared/utils/agent-images'
import { computed, useTemplateRef } from 'vue'
import { defineShortcuts } from '#imports'
import { UButton, UModal } from '#components'

const props = defineProps<{ sessionId: number, files: string[] }>()
const file = defineModel<string | null>({ required: true })

const index = computed(() => file.value ? props.files.indexOf(file.value) : -1)

function step(by: number) {
  if (index.value < 0) return
  const count = props.files.length
  file.value = props.files[(index.value + by + count) % count]!
}

// Focus lands on the bare frame: on an arrow or the dialog box it would draw the focus ring on open.
const frame = useTemplateRef<HTMLElement>('frame')
function focusFrame(event: Event) {
  event.preventDefault()
  frame.value?.focus()
}

defineShortcuts({
  arrowleft: () => step(-1),
  arrowright: () => step(1),
})
</script>

<template>
  <UModal
    :open="file !== null"
    title="Screenshot"
    :ui="{ content: 'w-auto max-w-none bg-transparent shadow-none ring-0' }"
    :content="{ onOpenAutoFocus: focusFrame }"
    @update:open="(value: boolean) => { if (!value) file = null }"
  >
    <template #content>
      <div
        ref="frame"
        tabindex="-1"
        class="flex items-center gap-2 outline-none"
        @click="file = null"
      >
        <UButton
          v-if="files.length > 1"
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="outline"
          aria-label="Previous screenshot"
          @mousedown.prevent
          @click.stop="step(-1)"
        />
        <img
          v-if="file"
          :src="agentImageUrl(sessionId, file)"
          alt="Screenshot"
          class="block max-h-[90vh] max-w-[calc(100vw-8rem)] cursor-zoom-out rounded-md object-contain"
        >
        <UButton
          v-if="files.length > 1"
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="outline"
          aria-label="Next screenshot"
          @mousedown.prevent
          @click.stop="step(1)"
        />
      </div>
    </template>
  </UModal>
</template>
