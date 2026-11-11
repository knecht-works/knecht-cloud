<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'

const props = defineProps<{
  uploadKey: string
  url: (file: File) => string
  to?: string
  accept?: string
  label?: string
  tooltip?: string
  icon?: string
  ariaLabel?: string
  size?: ButtonProps['size']
  color?: ButtonProps['color']
  variant?: ButtonProps['variant']
}>()
const emit = defineEmits<{ uploaded: [result: unknown] }>()
defineOptions({ inheritAttrs: false })

const { find, start } = useUploads()
const upload = computed(() => find(props.uploadKey))
const progress = computed(() => upload.value?.total ? upload.value.loaded / upload.value.total : 0)
const input = ref<HTMLInputElement>()

watch(() => upload.value?.promise, (promise) => {
  promise?.then(result => emit('uploaded', result), () => {})
}, { immediate: true })

function pick() {
  const file = input.value?.files?.[0]
  if (input.value) input.value.value = ''
  if (file) start({ key: props.uploadKey, url: props.url(file), file, to: props.to })
}
</script>

<template>
  <input
    ref="input"
    type="file"
    class="hidden"
    :accept="accept"
    @change="pick"
  >
  <UTooltip
    :text="upload ? 'Cancel upload' : tooltip"
    :disabled="!upload && !tooltip"
  >
    <UButton
      :size="size"
      :color="color"
      :variant="variant"
      :icon="label || upload ? undefined : icon"
      :label="label && upload ? 'Uploading' : label"
      :aria-label="upload ? 'Cancel upload' : ariaLabel"
      v-bind="$attrs"
      @click="upload ? upload.cancel() : input?.click()"
    >
      <template
        v-if="upload && !label"
        #leading
      >
        <KProgressRing :value="progress" />
      </template>
      <template
        v-if="upload && label"
        #trailing
      >
        <KProgressRing :value="progress" />
      </template>
    </UButton>
  </UTooltip>
</template>
