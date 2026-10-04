<script setup lang="ts">
const props = defineProps<{
  days: { success: number, failed: number }[]
}>()

const HEIGHT = 44

const max = computed(() => Math.max(1, ...props.days.map(d => d.success + d.failed)))
</script>

<template>
  <div
    class="flex w-full items-end gap-[3px]"
    :style="{ height: `${HEIGHT}px` }"
    aria-hidden="true"
  >
    <div
      v-for="(d, i) in days"
      :key="i"
      class="flex min-h-0.5 flex-1 flex-col-reverse overflow-hidden rounded-t-[2px] bg-(--surface-glass)"
    >
      <div
        class="bg-primary"
        :style="{ height: `${(d.success / max) * HEIGHT}px` }"
      />
      <div
        class="bg-(--status-error)"
        :style="{ height: `${(d.failed / max) * HEIGHT}px` }"
      />
    </div>
  </div>
</template>
