<script setup lang="ts">
// The ai step's model picker: opencode's catalog (/api/ai-models) in a
// searchable menu; empty means "use the default from Settings → Agent". Falls
// back to a plain input when the catalog can't be loaded.
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

// Step JSON stays clean: no `model` key at all while the default is selected.
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
