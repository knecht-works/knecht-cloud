<script setup lang="ts">
const props = defineProps<{
  sections: { label: string, icon: string, to: string }[]
}>()

const route = useRoute()

function isActive(to: string) {
  return to === props.sections[0]?.to ? route.path === to : route.path.startsWith(to)
}
</script>

<template>
  <div class="flex flex-col gap-5 lg:flex-row lg:gap-8">
    <nav class="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-4 lg:w-52 lg:flex-none lg:flex-col lg:self-start lg:overflow-visible lg:pb-0">
      <NuxtLink
        v-for="s in sections"
        :key="s.to"
        :to="s.to"
        class="relative flex flex-none items-center gap-2.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors"
        :class="isActive(s.to)
          ? 'border-default bg-(--surface-glass) text-highlighted'
          : 'border-transparent text-muted hover:text-toned'"
      >
        <span
          v-if="isActive(s.to)"
          class="absolute inset-y-2 -left-px hidden w-0.5 rounded-sm bg-primary lg:block"
          style="box-shadow: 0 0 8px var(--primary)"
        />
        <UIcon
          :name="s.icon"
          class="size-4 flex-none"
          :class="isActive(s.to) ? 'text-primary' : 'text-dimmed'"
        />
        {{ s.label }}
      </NuxtLink>
    </nav>

    <div class="min-w-0 flex-1">
      <slot />
    </div>
  </div>
</template>
