<script setup lang="ts">
import { passwordProblem } from '#shared/utils/account'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ hasPassword: boolean }>()
const emit = defineEmits<{ saved: [] }>()

const password = ref('')
const saving = ref(false)
const errors = ref<{ password?: string }>({})
watch(password, () => delete errors.value.password)
watch(open, (isOpen) => {
  if (!isOpen) return
  password.value = ''
  errors.value = {}
})

async function save() {
  errors.value = { password: passwordProblem(password.value) ?? undefined }
  if (errors.value.password) return
  saving.value = true
  try {
    await $fetch('/api/me/password', { method: 'POST', body: { password: password.value } })
    open.value = false
    emit('saved')
  }
  catch (e) {
    errors.value.password = errMsg(e, 'Could not save the password.')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="hasPassword ? 'Change password' : 'Set a password'"
    :description="hasPassword ? undefined : 'Then you can also sign in with your username and password.'"
  >
    <template #body>
      <form
        class="flex flex-col gap-4"
        @submit.prevent="save"
      >
        <UFormField
          label="New password"
          :error="errors.password"
        >
          <KPasswordInput
            v-model="password"
            autocomplete="new-password"
            placeholder="At least 12 characters"
            autofocus
            class="w-full"
          />
        </UFormField>
        <div class="flex justify-end">
          <UButton
            size="lg"
            type="submit"
            label="Save password"
            :loading="saving"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
