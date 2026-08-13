<script setup lang="ts">
// The detail-page header (project, workflow): one shared icon frame size, the
// title, a meta line and right-aligned actions. The meta line reserves its
// height even while empty, so a status label appearing there (a run starting)
// never pushes the title around.
defineProps<{
  icon: string
  iconColor?: string
  // Shown instead of the icon frame when the page has a favicon (projects).
  favicon?: string | null
}>()
</script>

<template>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 flex-1 gap-3.5">
      <span
        v-if="favicon"
        class="grid size-11.5 flex-none place-items-center rounded-[10px] border border-default bg-(--surface-accented)"
      >
        <img
          :src="favicon"
          alt=""
          class="size-7 object-contain"
        >
      </span>
      <KStepIcon
        v-else
        :icon="icon"
        :color="iconColor"
        :size="46"
        :radius="10"
      />
      <div class="min-w-0 flex-1">
        <slot />
        <div class="mt-1.5 flex min-h-6 flex-wrap items-center gap-3.5">
          <slot name="meta" />
        </div>
      </div>
    </div>
    <div class="flex flex-none items-center gap-2.5">
      <slot name="actions" />
    </div>
  </div>
</template>
