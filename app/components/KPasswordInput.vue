<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const model = defineModel<string>()
const visible = ref(false)
</script>

<template>
  <UInput
    v-model="model"
    :type="visible ? 'text' : 'password'"
    v-bind="$attrs"
    :ui="{ trailing: 'pe-1' }"
  >
    <template #trailing>
      <UButton
        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="visible ? 'Hide password' : 'Show password'"
        :aria-pressed="visible"
        color="neutral"
        variant="link"
        size="sm"
        @click="visible = !visible"
      />
    </template>
  </UInput>
</template>
