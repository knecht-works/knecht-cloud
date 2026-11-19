<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from '#imports'
import KStartSessionModal from '~/components/KStartSessionModal.vue'
import { UButton, UTooltip } from '#components'

const props = defineProps<{
  project: {
    id: number
    fullName: string
    defaultBranch: string
  }
}>()

const emit = defineEmits<{ runStarted: [runId: number] }>()

const startOpen = ref(false)

const route = useRoute()
const onSettings = computed(() => route.path.startsWith(`/projects/${props.project.id}/settings`))
</script>

<template>
  <div class="flex min-h-10 items-center justify-between gap-4">
    <slot name="breadcrumb" />
    <div class="flex flex-none items-center gap-2.5">
      <UTooltip text="Open a session on this project, with or without a workflow">
        <UButton
          size="lg"
          color="primary"
          label="Start session"
          @click="startOpen = true"
        />
      </UTooltip>
      <KStartSessionModal
        v-model:open="startOpen"
        :project="project"
        @run-started="runId => emit('runStarted', runId)"
      />
      <UTooltip :text="onSettings ? 'Project' : 'Settings'">
        <UButton
          size="lg"
          :to="onSettings ? `/projects/${project.id}` : `/projects/${project.id}/settings`"
          color="neutral"
          variant="outline"
          :icon="onSettings ? 'i-lucide-box' : 'i-lucide-settings'"
          :aria-label="onSettings ? 'Back to project' : 'Project settings'"
        />
      </UTooltip>
    </div>
  </div>
</template>
