<script setup lang="ts">
import { passwordProblem } from '#shared/utils/account'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ hasPassword: boolean }>()
const emit = defineEmits<{ saved: [] }>()

const currentPassword = ref('')
const password = ref('')
const saving = ref(false)
const errors = ref<{ currentPassword?: string, password?: string }>({})
watch(currentPassword, () => delete errors.value.currentPassword)
watch(password, () => delete errors.value.password)
watch(open, (isOpen) => {
  if (!isOpen) return
  currentPassword.value = ''
  password.value = ''
  errors.value = {}
})

async function save() {
  errors.value = {
    currentPassword: props.hasPassword && !currentPassword.value ? 'Enter your current password.' : undefined,
    password: passwordProblem(password.value) ?? undefined,
  }
  if (errors.value.currentPassword || errors.value.password) return
  saving.value = true
  try {
    await $fetch('/api/me/password', { method: 'POST', body: { currentPassword: currentPassword.value || undefined, password: password.value } })
    open.value = false
    emit('saved')
  }
  catch (e) {
    const field = (e as { data?: { data?: { field?: string } } }).data?.data?.field
    errors.value[field === 'currentPassword' ? 'currentPassword' : 'password'] = errMsg(e, 'Could not save the password.')
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
        id="password-form"
        class="flex flex-col gap-4"
        @submit.prevent="save"
      >
        <UFormField
          v-if="hasPassword"
          label="Current password"
          :error="errors.currentPassword"
        >
          <UInput
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            placeholder="Your current password"
            size="lg"
            autofocus
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="New password"
          :error="errors.password"
        >
          <UInput
            v-model="password"
            type="password"
            autocomplete="new-password"
            placeholder="At least 12 characters"
            size="lg"
            :autofocus="!hasPassword"
            class="w-full"
          />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="open = false"
        />
        <UButton
          type="submit"
          form="password-form"
          label="Save password"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
