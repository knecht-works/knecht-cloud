<script setup lang="ts">
const { open, finish } = useElevation()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const methods = ref<{ password: boolean, github: { username: string | null } } | null>(null)
const password = ref('')
const error = ref<string | undefined>()
const confirming = ref(false)

watch(open, async (isOpen) => {
  if (!isOpen) return
  password.value = ''
  error.value = undefined
  methods.value = await $fetch('/api/me/sign-in')
})
watch(password, () => {
  error.value = undefined
})

const githubUrl = computed(() => `/auth/github?elevate=1&return=${encodeURIComponent(route.fullPath)}`)

onMounted(() => {
  const result = route.query.reauth
  if (result === 'done') toast.add({ title: 'Confirmed', description: 'Try the action again.', color: 'success' })
  if (result === 'mismatch') toast.add({ title: 'Could not confirm', description: 'That GitHub account is not linked to you.', color: 'error' })
  if (result) router.replace({ query: { ...route.query, reauth: undefined } })
})

async function confirmPassword() {
  if (!password.value) {
    error.value = 'Enter your password.'
    return
  }
  confirming.value = true
  try {
    await $fetch('/auth/elevate', { method: 'POST', body: { password: password.value } })
    finish(true)
  }
  catch (e) {
    error.value = errMsg(e, 'Could not confirm.')
  }
  finally {
    confirming.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Confirm it’s you"
    description="This action needs a fresh confirmation. It lasts for an hour."
    @update:open="(value: boolean) => { if (!value) finish(false) }"
  >
    <template #body>
      <div
        v-if="methods"
        class="flex flex-col gap-4"
      >
        <form
          v-if="methods.password"
          id="reauth-form"
          @submit.prevent="confirmPassword"
        >
          <UFormField
            label="Password"
            :error="error"
          >
            <UInput
              v-model="password"
              type="password"
              autocomplete="current-password"
              placeholder="Your password"
              size="lg"
              autofocus
              class="w-full"
            />
          </UFormField>
        </form>
        <USeparator
          v-if="methods.password && methods.github.username"
          label="or"
        />
        <UButton
          v-if="methods.github.username"
          :to="githubUrl"
          external
          icon="i-simple-icons-github"
          color="neutral"
          size="lg"
          block
        >
          Confirm with GitHub
        </UButton>
      </div>
    </template>
    <template
      v-if="methods?.password"
      #footer
    >
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="finish(false)"
        />
        <UButton
          type="submit"
          form="reauth-form"
          label="Confirm"
          :loading="confirming"
        />
      </div>
    </template>
  </UModal>
</template>
