<script setup lang="ts">
defineProps<{
  field: StepField
  disabled?: boolean
}>()

const model = defineModel<string>()
const { data: models, status, error } = useAiModels()

// Sentinel, not '': Reka's Combobox reserves the empty string for "cleared".
const DEFAULT_ID = '__default__'
const items = computed(() => [
  { label: 'Default from Settings → Agent', id: DEFAULT_ID },
  ...models.value.map(m => ({ label: m.id, description: `${m.name} · ${m.provider}`, id: m.id })),
])

const value = computed({
  get: () => model.value || DEFAULT_ID,
  set: (v: string) => model.value = v === DEFAULT_ID ? undefined : v,
})
</script>

<template>
  <div>
    <span class="k-label">{{ field.label }}</span>
    <UInput
      v-if="error"
      v-model="model as string"
      spellcheck="false"
      :disabled="disabled"
      :placeholder="field.placeholder"
      class="mt-1.5 w-full"
      :ui="{ base: 'k-mono' }"
    />
    <USelectMenu
      v-else
      v-model="value"
      :items="items"
      value-key="id"
      :filter-fields="['label', 'description']"
      :loading="status === 'pending'"
      :disabled="disabled"
      :placeholder="field.placeholder"
      class="mt-1.5 w-full"
      :ui="{ base: 'k-mono' }"
    />
  </div>
</template>
