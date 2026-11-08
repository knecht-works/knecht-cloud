<script setup lang="ts">
defineOptions({ inheritAttrs: false })

defineProps<{
  unit: string
}>()

const model = defineModel<number>()
</script>

<template>
  <UInput
    v-model.number="model"
    type="number"
    v-bind="$attrs"
    :ui="{ base: 'pe-11', trailing: 'pe-3' }"
  >
    <template #trailing>
      <span class="text-xs text-dimmed">{{ unit }}</span>
    </template>
  </UInput>
</template>
