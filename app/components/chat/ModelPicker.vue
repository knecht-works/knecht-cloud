<script setup lang="ts">
const model = defineModel<string | null>({ default: null })
const { data: models, error } = useAiModels()
const { data: settings } = useSettings()

// Sentinel, not '': Reka's Combobox reserves the empty string for "cleared".
const DEFAULT_ID = '__default__'
const items = computed(() => [
  { label: settings.value?.aiModel ?? 'Default model', id: DEFAULT_ID },
  ...models.value.map(m => ({ label: m.id, id: m.id })),
])
const value = computed({
  get: () => model.value ?? DEFAULT_ID,
  set: (v: string) => model.value = v === DEFAULT_ID ? null : v,
})
</script>

<template>
  <USelectMenu
    v-if="!error"
    v-model="value"
    :items="items"
    value-key="id"
    size="sm"
    variant="ghost"
    color="neutral"
    icon="i-lucide-cpu"
    :search-input="{ placeholder: 'Model' }"
    :ui="{ base: 'k-mono text-2xs text-dimmed max-w-64', item: 'k-mono text-2xs' }"
  />
</template>
