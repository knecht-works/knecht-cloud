<script setup lang="ts">
// Confirmation gate for destructive actions (disconnect project, delete
// workflow, delete run). The caller owns the action: it opens the modal,
// passes its loading state and runs the action on @confirm.
const open = defineModel<boolean>('open', { required: true })

defineProps<{
  title: string
  description: string
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
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="() => { open = false }"
        />
        <UButton
          color="error"
          :label="confirmLabel ?? 'Delete'"
          :loading="loading"
          @click="emit('confirm')"
        />
      </div>
    </template>
  </UModal>
</template>
