<script setup lang="ts">
import { computed, ref } from 'vue'
import { frameworkMeta } from '~/utils/dashboard'
import KStartSessionModal from '~/components/KStartSessionModal.vue'
import KStepIcon from '~/components/KStepIcon.vue'
import { NuxtLink, UButton, UIcon, UTooltip } from '#components'

const props = defineProps<{
  project: {
    id: number
    fullName: string
    defaultBranch: string
    repoUrl: string
    framework?: string | null
    favicon?: string | null
  }
}>()

const emit = defineEmits<{ runStarted: [runId: number] }>()

const startOpen = ref(false)

const fw = computed(() => frameworkMeta(props.project.framework))
const repoName = computed(() => props.project.fullName.split('/').pop() ?? 'Project')
</script>

<template>
  <div>
    <div class="flex min-h-10 items-center justify-between gap-4">
      <div class="flex min-w-0 items-center gap-3">
        <span
          v-if="project.favicon"
          class="grid size-9 flex-none place-items-center rounded-lg border border-default bg-(--surface-accented)"
        >
          <img
            :src="project.favicon"
            alt=""
            class="size-5 object-contain"
          >
        </span>
        <KStepIcon
          v-else
          icon="i-lucide-box"
          :color="fw.color"
          :size="36"
          :radius="8"
        />
        <UTooltip :text="project.fullName">
          <h1 class="truncate text-2xl font-semibold tracking-tight text-highlighted">
            <NuxtLink :to="`/projects/${project.id}`">
              {{ repoName }}
            </NuxtLink>
          </h1>
        </UTooltip>
        <a
          :href="project.repoUrl"
          target="_blank"
          rel="noopener"
          :aria-label="`${project.fullName} on GitHub`"
          class="flex flex-none text-dimmed transition-colors hover:text-muted"
        >
          <UIcon
            name="i-simple-icons-github"
            class="size-4"
          />
        </a>
      </div>

      <div class="flex-none">
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
      </div>
    </div>
  </div>
</template>
