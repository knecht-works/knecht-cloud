<script setup lang="ts">
import { useProjectAiModels } from '~/composables/useAiModels'
import { useProjectAi } from '~/composables/useProjects'
import { computed, watch } from 'vue'
import { USelectMenu } from '#components'

const props = defineProps<{ projectId: number }>()
const model = defineModel<string | null>({ default: null })
const { data: models, status, error } = useProjectAiModels(props.projectId)
const { data: ai } = useProjectAi(props.projectId)
// A remembered model the provider no longer offers would fail the turn without showing in the picker.
watch([models, status, model], () => {
  if (status.value === 'success' && model.value && !models.value.some(m => m.id === model.value)) model.value = null
}, { immediate: true })

// Sentinel, not '': Reka's Combobox reserves the empty string for "cleared".
const DEFAULT_ID = '__default__'
const items = computed(() => [
  { label: ai.value?.effective.aiModel ?? 'Default model', id: DEFAULT_ID },
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
