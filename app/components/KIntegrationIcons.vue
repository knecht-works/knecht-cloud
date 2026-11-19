<script setup lang="ts">
import { UIcon, UTooltip } from '#components'

defineProps<{
  items: { icon: string, label: string, color: string }[]
}>()
</script>

<template>
  <span class="flex gap-1">
    <UTooltip
      v-for="t in items"
      :key="t.label"
      :text="t.label"
    >
      <span
        class="grid size-5.5 place-items-center rounded-[5px] bg-(--surface-accented)"
        :style="{ color: t.color }"
        :aria-label="t.label"
      >
        <UIcon
          :name="t.icon"
          class="size-3.25"
        />
      </span>
    </UTooltip>
  </span>
</template>
