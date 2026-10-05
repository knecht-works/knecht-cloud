<script setup lang="ts">
const props = defineProps<{
  project: {
    fullName: string
    framework?: string | null
    favicon?: string | null
  }
}>()

const fw = computed(() => frameworkMeta(props.project.framework))
const repoName = computed(() => props.project.fullName.split('/').pop() ?? 'Project')
</script>

<template>
  <KPageHeader
    icon="i-lucide-box"
    :icon-color="fw.color"
    :favicon="project.favicon"
    :icon-size="40"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <h1 class="k-mono truncate text-2xl font-semibold tracking-tight text-highlighted">
        {{ repoName }}
      </h1>
      <UTooltip :text="project.fullName">
        <a
          :href="`https://github.com/${project.fullName}`"
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
      </UTooltip>
    </div>
  </KPageHeader>
</template>
