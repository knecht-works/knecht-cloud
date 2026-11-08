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
      <KGithubButton
        :to="githubUrl"
        external
        :last-used="showLastUsed('github')"
      >
        {{ githubLabel }}
      </KGithubButton>
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
          :disabled="!!fixedUsername"
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
        <KPasswordInput
          v-model="password"
          :placeholder="newAccount ? 'Choose a password' : 'Your password'"
          :autofocus="!!fixedUsername"
          :autocomplete="newAccount ? 'new-password' : 'current-password'"
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        color="primary"
        block
        class="mt-2"
        :loading="submitting"
      >
        {{ submitLabel }}
      </UButton>
    </form>
  </div>
</template>
