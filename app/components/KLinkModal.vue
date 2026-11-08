<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  title: string
  description: string
  url: string
  copied?: boolean
}>()

const toast = useToast()
const done = ref(false)
watch(() => [props.url, props.copied] as const, ([, copied]) => {
  done.value = !!copied
}, { immediate: true })

async function copy() {
  try {
    await copyText(props.url)
    done.value = true
  }
  catch {
    toast.add({ title: 'Could not copy the link', description: 'Select it and copy it by hand.', color: 'warning' })
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
  >
    <template #body>
      <div class="flex gap-2">
        <UInput
          :model-value="url"
          readonly
          class="flex-1"
          aria-label="Link"
          @focus="(e: FocusEvent) => (e.target as HTMLInputElement).select()"
        />
        <UButton
          :label="done ? 'Copied' : 'Copy'"
          color="neutral"
          variant="outline"
          @click="copy"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end">
        <UButton
          size="lg"
          label="Done"
          @click="() => { open = false }"
        />
      </div>
    </template>
  </UModal>
</template>
