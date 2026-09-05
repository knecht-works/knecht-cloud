<script setup lang="ts">
// A titled surface panel: a hairline header (icon + uppercase mono label +
// optional action slot) above a body. The detail screen's building block.
// `collapsible` makes the header a toggle for the body; panels start open,
// collapsing is for getting long content (e.g. the run log) out of the way.
// The icon is green unless a panel passes its own accent; `pad` is the
// body's horizontal padding, the vertical one is a bit tighter so the body
// reads as evenly inset. The header has a fixed height: an action (a save
// status appearing) must not move the body.
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
      class="flex h-10 items-center gap-2.5 px-4.5"
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
        :style="{ color: accent ?? 'var(--primary)' }"
      />
      <span class="k-mono text-2xs uppercase tracking-widest text-toned">{{ title }}</span>
      <div
        v-if="$slots.action"
        class="ml-auto flex items-center"
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
      :style="{ padding: `${props.pad * 0.7}px ${props.pad}px` }"
    >
      <slot />
    </div>
  </div>
</template>
