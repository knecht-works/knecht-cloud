<script setup lang="ts">
withDefaults(defineProps<{
  icon: string
  iconColor?: string
  favicon?: string | null
  iconSize?: number
}>(), { iconSize: 62 })
</script>

<template>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 flex-1 items-center gap-3.5">
      <span
        v-if="favicon"
        class="grid flex-none place-items-center border border-default bg-(--surface-accented)"
        :style="{ width: `${iconSize}px`, height: `${iconSize}px`, borderRadius: `${iconSize * 0.19}px` }"
      >
        <img
          :src="favicon"
          alt=""
          class="object-contain"
          :style="{ width: `${iconSize * 0.58}px`, height: `${iconSize * 0.58}px` }"
        >
      </span>
      <KStepIcon
        v-else
        :icon="icon"
        :color="iconColor"
        :size="iconSize"
        :radius="iconSize * 0.19"
      />
      <div class="min-w-0 flex-1">
        <slot />
        <div
          v-if="$slots.meta"
          class="mt-0.5 flex min-h-5 flex-wrap items-center gap-3.5"
        >
          <slot name="meta" />
        </div>
      </div>
    </div>
    <div class="flex flex-none items-center gap-2.5">
      <slot name="actions" />
    </div>
  </div>
</template>
