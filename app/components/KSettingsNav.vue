<script setup lang="ts">
import { useRoute } from '#imports'
import { UIcon, NuxtLink } from '#components'

const props = defineProps<{
  sections: { label: string, icon?: string, to: string }[]
  tabs?: boolean
}>()

const route = useRoute()

// A section whose path prefixes another section's matches only itself.
function isActive(to: string) {
  const hasChildSection = props.sections.some(s => s.to !== to && s.to.startsWith(`${to}/`))
  return hasChildSection ? route.path === to : route.path.startsWith(to)
}
</script>

<template>
  <div
    v-if="tabs"
    class="flex flex-col gap-5"
  >
    <nav class="-m-0.5 flex gap-6 overflow-x-auto p-0.5">
      <NuxtLink
        v-for="s in sections"
        :key="s.to"
        :to="s.to"
        class="flex flex-none items-center gap-2.5 border-b pb-2 text-sm font-medium transition-colors"
        :class="isActive(s.to)
          ? 'border-primary text-highlighted'
          : 'border-transparent text-muted hover:text-toned'"
      >
        <UIcon
          v-if="s.icon"
          :name="s.icon"
          class="size-4 flex-none"
          :class="isActive(s.to) ? 'text-primary' : 'text-dimmed'"
        />
        {{ s.label }}
      </NuxtLink>
    </nav>
    <slot />
  </div>
  <div
    v-else
    class="-mx-8 -mb-7 flex flex-col lg:flex-row"
  >
    <nav class="k-scrollbar-none flex flex-none gap-px overflow-x-auto px-5 pb-4 lg:sticky lg:top-0 lg:w-64 lg:flex-col lg:self-start lg:overflow-visible lg:pb-2">
      <NuxtLink
        v-for="s in sections"
        :key="s.to"
        :to="s.to"
        class="relative flex flex-none items-center rounded-md border px-3 py-2 text-sm font-medium transition-colors"
        :class="isActive(s.to)
          ? 'border-default bg-(--surface-glass) text-highlighted'
          : 'border-transparent text-muted hover:text-toned'"
      >
        <span
          v-if="isActive(s.to)"
          class="absolute inset-y-2 -left-px hidden w-0.5 rounded-sm bg-primary lg:block"
          style="box-shadow: 0 0 8px var(--primary)"
        />
        {{ s.label }}
      </NuxtLink>
    </nav>

    <div class="min-w-0 flex-1 px-8 pb-7 lg:pl-1">
      <slot />
    </div>
  </div>
</template>
