<script setup lang="ts">
// A screen's top bar: a title block (optional eyebrow + subtitle) with a
// right-aligned actions slot. Standard header across the dashboard screens.
withDefaults(defineProps<{
  title: string
  sub?: string
  eyebrow?: string
}>(), {})
</script>

<template>
  <div class="mb-4.5 flex items-center justify-between gap-6">
    <div class="min-w-0">
      <div
        v-if="eyebrow"
        class="k-label mb-2 flex items-center gap-2 text-muted"
      >
        <KStatusDot :size="6" /> {{ eyebrow }}
      </div>
      <h1 class="text-xl font-semibold leading-tight tracking-tight text-highlighted">
        {{ title }}
      </h1>
      <p
        v-if="sub"
        class="mt-1.5 max-w-140 text-2sm text-muted"
      >
        {{ sub }}
      </p>
    </div>
    <div
      v-if="$slots.actions"
      class="flex flex-none items-center gap-3"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
