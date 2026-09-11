<script setup lang="ts">
import type { SessionObjectKind } from '~/utils/dashboard'

defineProps<{
  object: {
    kind: SessionObjectKind
    number: number | null
    title: string | null
    url: string | null
    closed: boolean
    live: boolean
  }
  project?: { id: number, name: string }
}>()
</script>

<template>
  <div class="flex items-center gap-2 px-4.5 pb-1 pt-3">
    <UIcon
      :name="object.closed ? sessionObjectMeta(object.kind).closedIcon : sessionObjectMeta(object.kind).icon"
      class="size-3.5 flex-none"
      :style="{ color: object.closed ? 'var(--text-dimmed)' : sessionObjectMeta(object.kind).color }"
    />
    <span class="k-mono flex-none text-2xs text-dimmed">#{{ object.number }}</span>
    <UTooltip :text="object.title ?? ''">
      <span
        class="k-mono min-w-0 truncate text-2xs"
        :class="object.closed ? 'text-dimmed' : 'text-muted'"
      >{{ object.title }}</span>
    </UTooltip>
    <span class="ml-auto flex flex-none items-center gap-2">
      <NuxtLink
        v-if="project"
        :to="`/projects/${project.id}`"
        class="k-mono hidden text-2xs text-dimmed transition-colors hover:text-muted md:block"
      >{{ project.name }}</NuxtLink>
      <KStatusDot
        v-if="object.live"
        color="primary"
        :size="5"
      />
      <a
        v-if="object.url"
        :href="object.url"
        target="_blank"
        class="flex text-dimmed transition-colors hover:text-muted"
        :aria-label="`Open ${object.kind === 'issue' ? 'issue' : 'pull request'} #${object.number} on GitHub`"
      >
        <UIcon
          name="i-lucide-arrow-up-right"
          class="size-3.5"
        />
      </a>
    </span>
  </div>
</template>
