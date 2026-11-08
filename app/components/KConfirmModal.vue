<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

defineProps<{
  title: string
  description: string
  detail: string
  confirmLabel?: string
  loading?: boolean
}>()

const emit = defineEmits<{ confirm: [] }>()
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted">
          {{ detail }}
        </p>
        <div class="flex justify-end">
          <UButton
            size="lg"
            color="error"
            :label="confirmLabel ?? 'Delete'"
            :loading="loading"
            @click="emit('confirm')"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
