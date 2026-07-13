<script setup lang="ts">
// A titled surface panel: a hairline header (icon + uppercase mono label +
// optional action slot) above a body. The detail screen's building block.
// `collapsible` makes the header a toggle for the body; panels start open,
// collapsing is for getting long content (e.g. the run log) out of the way.
const props = withDefaults(defineProps<{
  title: string
  icon?: string
  accent?: string
  pad?: number
  collapsible?: boolean
}>(), {
  pad: 20,
  collapsible: false,
})

const open = ref(true)
</script>

<template>
  <div class="k-card overflow-hidden">
    <component
      :is="collapsible ? 'button' : 'div'"
      :type="collapsible ? 'button' : undefined"
      class="flex items-center gap-2.5 px-4.5 py-3.5"
      :class="[
        open ? 'border-b border-muted' : '',
        collapsible ? 'w-full text-left' : '',
      ]"
      :aria-expanded="collapsible ? open : undefined"
      @click="collapsible && (open = !open)"
    >
      <UIcon
        v-if="icon"
        :name="icon"
        class="size-4"
        :style="{ color: accent ?? 'var(--text-dimmed)' }"
      />
      <span class="k-mono text-2xs uppercase tracking-widest text-toned">{{ title }}</span>
      <div
        v-if="$slots.action"
        class="ml-auto"
      >
        <slot name="action" />
      </div>
      <UIcon
        v-if="collapsible"
        name="i-lucide-chevron-down"
        class="size-3.5 shrink-0 text-dimmed transition-transform"
        :class="[open ? 'rotate-180' : '', $slots.action ? '' : 'ml-auto']"
      />
    </component>
    <div
      v-show="open"
      :style="{ padding: `${props.pad}px` }"
    >
      <slot />
    </div>
  </div>
</template>
