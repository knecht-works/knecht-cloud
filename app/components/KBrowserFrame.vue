<script setup lang="ts">
// Fake browser chrome used to frame the live preview: traffic lights, a centred
// mono address bar with a lock glyph, and an optional right-side status action.
withDefaults(defineProps<{
  url?: string
  action?: string
}>(), {
  url: 'app.knecht.local',
})
</script>

<template>
  <div
    class="overflow-hidden rounded-(--radius-lg) border border-(--border-default) bg-(--surface-muted)"
    style="box-shadow: var(--shadow-browser)"
  >
    <div class="flex items-center gap-4 border-b border-(--border-default) bg-(--surface-elevated) px-4 py-3">
      <div class="flex flex-none items-center gap-2">
        <span class="size-3 rounded-full bg-[rgba(248,113,113,0.8)]" />
        <span class="size-3 rounded-full bg-[rgba(252,196,110,0.85)]" />
        <span class="size-3 rounded-full bg-[rgba(183,248,162,0.85)]" />
      </div>
      <div class="flex min-w-0 flex-1 items-center justify-center">
        <span class="k-mono inline-flex max-w-full items-center gap-2 truncate rounded-(--radius-sm) bg-(--surface-base) px-3 py-1 text-xs text-(--text-muted)">
          <UIcon
            name="i-lucide-lock"
            class="size-[11px] flex-none"
          />
          {{ url }}
        </span>
      </div>
      <span
        v-if="action"
        class="k-mono flex flex-none items-center gap-1.5 text-xs text-(--text-dimmed)"
      >
        <KStatusDot
          color="neutral"
          :glow="false"
          :size="6"
        />
        {{ action }}
      </span>
    </div>
    <div class="bg-(--surface-base)">
      <slot />
    </div>
  </div>
</template>
