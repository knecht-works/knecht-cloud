<script setup lang="ts">
import { LAST_LOGIN_COOKIE, passwordProblem, usernameProblem, type LoginMethod } from '#shared/utils/account'

const props = defineProps<{
  endpoint: string
  githubUrl: string | null
  githubLabel: string
  submitLabel: string
  // A new account: checks the username and password rules before submitting.
  newAccount?: boolean
  // Shown read-only, for setting a new password of a known member.
  fixedUsername?: string
}>()

const lastUsed = useCookie<LoginMethod | null>(LAST_LOGIN_COOKIE)
const showLastUsed = (method: LoginMethod) => !props.newAccount && lastUsed.value === method

const { fetch: refreshSession } = useUserSession()
const username = ref(props.fixedUsername ?? '')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<{ username?: string, password?: string }>({})
watch(username, () => delete fieldErrors.value.username)
watch(password, () => delete fieldErrors.value.password)

function check(): boolean {
  const name = username.value.trim()
  fieldErrors.value = props.newAccount
    ? { username: usernameProblem(name) ?? undefined, password: passwordProblem(password.value) ?? undefined }
    : { username: name ? undefined : 'Enter your username.', password: password.value ? undefined : 'Enter your password.' }
  return !fieldErrors.value.username && !fieldErrors.value.password
}

async function submit() {
  error.value = null
  if (!check()) return
  submitting.value = true
  try {
    await $fetch(props.endpoint, { method: 'POST', body: { username: username.value, password: password.value } })
    await refreshSession()
    await navigateTo('/')
  }
  catch (e) {
    const field = (e as { data?: { data?: { field?: string } } }).data?.data?.field
    if (field === 'username' || field === 'password') fieldErrors.value[field] = errMsg(e, '')
    else error.value = errMsg(e, 'Something went wrong. Please try again.')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <template v-if="githubUrl">
      <UButton
        :to="githubUrl"
        external
        icon="i-simple-icons-github"
        color="neutral"
        size="lg"
        block
        class="justify-start"
      >
        {{ githubLabel }}
        <template #trailing>
          <span class="ms-auto flex items-center gap-2">
            <KLastUsedBadge v-if="showLastUsed('github')" />
            <UIcon
              name="i-lucide-arrow-right"
              class="size-4"
            />
          </span>
        </template>
      </UButton>
      <USeparator label="or" />
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="error"
    />

    <form
      class="flex flex-col gap-4"
      @submit.prevent="submit"
    >
      <UFormField
        label="Username"
        :error="fieldErrors.username"
      >
        <template
          v-if="showLastUsed('password')"
          #hint
        >
          <KLastUsedBadge />
        </template>
        <UInput
          v-model="username"
          :placeholder="newAccount ? 'Choose a username' : 'Your username'"
          size="lg"
          :readonly="!!fixedUsername"
          :autofocus="!fixedUsername"
          autocomplete="username"
          autocapitalize="off"
          spellcheck="false"
          class="w-full"
        />
      </UFormField>
      <UFormField
        label="Password"
        :error="fieldErrors.password"
      >
        <UInput
          v-model="password"
          :placeholder="newAccount ? 'Choose a password' : 'Your password'"
          size="lg"
          :autofocus="!!fixedUsername"
          :type="showPassword ? 'text' : 'password'"
          :autocomplete="newAccount ? 'new-password' : 'current-password'"
          class="w-full"
          :ui="{ trailing: 'pe-1' }"
        >
          <template #trailing>
            <UButton
              :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :aria-label="showPassword ? 'Hide password' : 'Show password'"
              :aria-pressed="showPassword"
              color="neutral"
              variant="link"
              size="sm"
              @click="showPassword = !showPassword"
            />
          </template>
        </UInput>
      </UFormField>
      <UButton
        type="submit"
        color="primary"
        size="lg"
        block
        class="mt-2"
        :loading="submitting"
      >
        {{ submitLabel }}
      </UButton>
    </form>
  </div>
</template>
