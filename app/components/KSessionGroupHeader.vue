<script setup lang="ts">
import type { IntegrationId, ObjectKind } from '#shared/utils/integrations'

const props = defineProps<{
  object: {
    integration: IntegrationId
    kind: ObjectKind
    key: string | null
    title: string | null
    url: string | null
    closed: boolean
    live: boolean
  }
  project?: { id: number, name: string }
}>()

const meta = computed(() => sessionObjectMeta(props.object.integration, props.object.kind))
</script>

<template>
  <div class="flex items-center gap-2 px-4.5 pb-1 pt-3">
    <UIcon
      :name="object.closed ? meta.closedIcon : meta.icon"
      class="size-3.5 flex-none"
      :style="{ color: object.closed ? 'var(--text-dimmed)' : meta.color }"
    />
    <UTooltip :text="object.title ?? ''">
      <span
        class="k-mono min-w-0 truncate text-xs"
        :class="object.closed ? 'text-dimmed' : 'text-default'"
      >{{ object.title }}</span>
    </UTooltip>
    <span class="k-mono flex-none text-2xs text-dimmed">{{ meta.prefix }}{{ object.key }}</span>
    <span class="ml-auto flex flex-none items-center gap-2">
      <NuxtLink
        v-if="project"
        :to="`/projects/${project.id}`"
        class="k-mono hidden text-2xs text-dimmed transition-colors hover:text-muted md:block"
      >{{ project.name }}</NuxtLink>
      <a
        v-if="object.url"
        :href="object.url"
        target="_blank"
        class="flex text-dimmed transition-colors hover:text-muted"
        :aria-label="`Open ${meta.label.toLowerCase()} ${meta.prefix}${object.key} in ${triggerSourceMeta(object.integration).label}`"
      >
        <UIcon
          name="i-lucide-arrow-up-right"
          class="size-3.5"
        />
      </a>
    </span>
  </div>
</template>
