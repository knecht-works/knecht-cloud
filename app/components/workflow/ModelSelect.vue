<script setup lang="ts">
import type { StepField } from '~/utils/workflow-steps'
import { useAiModels } from '~/composables/useAiModels'
import { SUBTASK_MODEL_REF } from '#shared/utils/ai'
import { computed } from 'vue'
import KCodeInput from '~/components/KCodeInput.vue'
import { USelectMenu, UFormField } from '#components'

defineProps<{
  field: StepField
  disabled?: boolean
}>()

const model = defineModel<string>()
const { data: models, status, error } = useAiModels()

// Sentinel, not '': Reka's Combobox reserves the empty string for "cleared".
const DEFAULT_ID = '__default__'
const DEFAULT_SOURCE = 'Set by global or project settings'
const items = computed(() => [
  { label: 'Default model', description: DEFAULT_SOURCE, id: DEFAULT_ID },
  { label: 'Default subtask model', description: DEFAULT_SOURCE, id: SUBTASK_MODEL_REF },
  ...models.value.map(m => ({ label: m.id, description: `${m.name} · ${m.provider}`, id: m.id })),
])

const value = computed({
  get: () => model.value || DEFAULT_ID,
  set: (v: string) => model.value = v === DEFAULT_ID ? undefined : v,
})
</script>

<template>
  <UFormField :label="field.label">
    <KCodeInput
      v-if="error"
      v-model="model as string"
      :disabled="disabled"
      :placeholder="field.placeholder"
      class="w-full"
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
      class="w-full"
    />
  </UFormField>
</template>
