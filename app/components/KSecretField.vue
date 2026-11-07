<script setup lang="ts">
const model = defineModel<string>({ required: true })

const props = defineProps<{
  preview?: string | null
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
}>()

const focused = ref(false)
const masked = computed(() => !!props.preview && !focused.value && !model.value)
</script>

<template>
  <div class="flex items-center gap-2">
    <UInput
      :model-value="masked ? preview! : model"
      :type="masked ? 'text' : 'password'"
      :readonly="masked"
      :placeholder="preview ? 'Enter a new value to replace it' : placeholder"
      :disabled="disabled"
      :trailing-icon="preview ? 'i-lucide-lock' : undefined"
      :ui="{ trailingIcon: 'size-3.5 text-dimmed' }"
      autocomplete="new-password"
      spellcheck="false"
      :color="invalid ? 'error' : undefined"
      :highlight="invalid"
      class="min-w-0 flex-1"
      @update:model-value="(value: string | number) => { if (!masked) model = String(value) }"
      @focus="() => { focused = true }"
      @blur="() => { focused = false }"
    />
    <slot />
  </div>
</template>
