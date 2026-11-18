<script setup lang="ts">
const props = defineProps<{
  objects: SessionObject[]
  project?: { id: number, name: string }
}>()

const primary = computed(() => props.objects[0]!)
const badges = computed(() => props.objects.map(o => ({ ...o, meta: sessionObjectMeta(o.integration, o.kind) })))
</script>

<template>
  <div class="flex items-center gap-2.5 px-4.5 pb-1 pt-3">
    <UIcon
      :name="badges[0]!.meta.icon"
      class="size-3.5 flex-none"
      :style="{ color: primary.closed ? 'var(--text-dimmed)' : badges[0]!.meta.color }"
    />
    <UTooltip :text="primary.title ?? ''">
      <span class="k-mono min-w-0 truncate text-xs text-default">{{ primary.title }}</span>
    </UTooltip>
    <span class="flex flex-none items-center gap-1.5">
      <component
        :is="o.url ? 'a' : 'span'"
        v-for="o in badges"
        :key="`${o.integration}:${o.kind}:${o.key}`"
        :href="o.url ?? undefined"
        :target="o.url ? '_blank' : undefined"
        class="k-mono flex items-center gap-1 rounded-full border border-muted px-1.5 text-2xs text-dimmed transition-colors"
        :class="o.url ? 'hover:text-muted' : ''"
        :aria-label="o.url ? `Open ${o.meta.label.toLowerCase()} ${o.meta.prefix}${o.key} in ${triggerSourceMeta(o.integration).label}` : undefined"
      >
        <UIcon
          v-if="o !== badges[0]"
          :name="o.meta.icon"
          class="size-3"
          :style="{ color: o.closed ? 'var(--text-dimmed)' : o.meta.color }"
        />
        {{ o.meta.prefix }}{{ o.key }}
      </component>
    </span>
    <NuxtLink
      v-if="project"
      :to="`/projects/${project.id}`"
      class="k-mono ml-auto hidden flex-none text-2xs text-dimmed transition-colors hover:text-muted md:block"
    >{{ project.name }}</NuxtLink>
  </div>
</template>
