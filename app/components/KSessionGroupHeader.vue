<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { SessionObject } from '~/utils/dashboard'
import { computed } from 'vue'
import { sessionObjectMeta, triggerSourceMeta } from '~/utils/dashboard'
import { UIcon, NuxtLink, UTooltip } from '#components'

const props = defineProps<{
  objects: SessionObject[]
  title: string
  project?: { id: number, name: string }
  to: RouteLocationRaw
  replace?: boolean
  quiet?: boolean
}>()

const badges = computed(() => props.objects.map(o => ({ ...o, meta: sessionObjectMeta(o.integration, o.kind) })))
const allClosed = computed(() => props.objects.length > 0 && props.objects.every(o => o.closed))
const icon = computed(() => badges.value[0]?.meta.icon ?? 'i-lucide-message-square')
const tint = computed(() => allClosed.value ? 'var(--text-dimmed)' : badges.value[0]?.meta.color ?? 'var(--text-toned)')
</script>

<template>
  <div class="flex items-center gap-2.5 pl-2">
    <span
      class="grid size-5 flex-none place-items-center rounded-md"
      :style="{ background: `color-mix(in oklab, ${tint} 16%, transparent)` }"
    >
      <UIcon
        :name="icon"
        class="size-3"
        :style="{ color: tint }"
      />
    </span>
    <UTooltip :text="title">
      <NuxtLink
        :to="to"
        :replace="replace"
        tabindex="-1"
        class="relative z-2 min-w-0 truncate text-sm font-medium"
        :class="allClosed ? (quiet ? 'text-dimmed' : 'text-muted') : quiet ? 'text-toned transition-colors group-hover:text-highlighted' : 'text-highlighted'"
      >
        {{ title }}
      </NuxtLink>
    </UTooltip>
    <div class="flex flex-none items-center gap-2 text-xs text-dimmed">
      <component
        :is="o.url ? 'a' : 'span'"
        v-for="o in badges"
        :key="`${o.integration}:${o.kind}:${o.key}`"
        :href="o.url ?? undefined"
        :target="o.url ? '_blank' : undefined"
        class="relative z-2 flex items-center gap-1 tabular-nums transition-colors"
        :class="o.url ? 'hover:text-muted' : ''"
        :aria-label="o.url ? `Open ${o.meta.label.toLowerCase()} ${o.meta.prefix}${o.key} in ${triggerSourceMeta(o.integration).label}` : undefined"
      >
        <UIcon
          :name="o.meta.icon"
          class="size-3"
          :style="{ color: o.closed ? 'var(--text-dimmed)' : o.meta.color }"
        />
        {{ o.kind === 'pull_request' ? 'PR ' : '' }}{{ o.meta.prefix }}{{ o.key }}
      </component>
    </div>
    <NuxtLink
      v-if="project"
      :to="`/projects/${project.id}`"
      class="relative z-2 ml-auto hidden flex-none text-xs text-dimmed transition-colors hover:text-muted md:block"
    >{{ project.name }}</NuxtLink>
  </div>
</template>
