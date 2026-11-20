<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { UInput, UButton } from '#components'

const model = defineModel<string>({ required: true })

const props = defineProps<{
  preview?: string | null
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
}>()

const focused = ref(false)
const masked = computed(() => !!props.preview && !focused.value && !model.value)
const revealed = ref(false)
watch(model, (value) => {
  if (!value) revealed.value = false
})
</script>

<template>
  <div class="flex items-center gap-2">
    <UInput
      :model-value="masked ? preview! : model"
      :type="masked || revealed ? 'text' : 'password'"
      :readonly="masked"
      :placeholder="preview ? 'Enter a new value to replace it' : placeholder"
      :disabled="disabled"
      :trailing-icon="preview ? 'i-lucide-lock' : undefined"
      :ui="{ trailingIcon: 'size-3.5 text-dimmed', trailing: model ? 'pe-1' : undefined }"
      autocomplete="new-password"
      spellcheck="false"
      :color="invalid ? 'error' : undefined"
      :highlight="invalid"
      class="min-w-0 flex-1"
      @update:model-value="(value: string | number) => { if (!masked) model = String(value) }"
      @focus="() => { focused = true }"
      @blur="() => { focused = false }"
    >
      <template
        v-if="model"
        #trailing
      >
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          :icon="revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          :aria-label="revealed ? 'Hide value' : 'Show value'"
          :aria-pressed="revealed"
          :disabled="disabled"
          @click="revealed = !revealed"
        />
      </template>
    </UInput>
    <slot />
  </div>
</template>
