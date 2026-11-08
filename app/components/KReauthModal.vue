<script setup lang="ts">
import { LAST_LOGIN_COOKIE, type LoginMethod } from '#shared/utils/account'

const { open, finish } = useElevation()
const route = useRoute()
const router = useRouter()
const toast = useToast()

// The cache of useSignInMethods: loaded here only when no page has loaded it yet.
const { data: methods } = useNuxtData<{ password: boolean, github: { username: string | null } }>('me:sign-in')
const lastUsed = useCookie<LoginMethod | null>(LAST_LOGIN_COOKIE)
const password = ref('')
const error = ref<string | undefined>()
const confirming = ref(false)

watch(open, async (isOpen) => {
  if (!isOpen) return
  password.value = ''
  error.value = undefined
  methods.value ??= await $fetch('/api/me/sign-in')
})
watch(password, () => {
  error.value = undefined
})

const githubUrl = computed(() => `/auth/github?elevate=1&return=${encodeURIComponent(route.fullPath)}`)

let popup: Window | null = null
function confirmWithGithub() {
  popup = window.open('/auth/github?elevate=1&return=/reauth', 'knecht-reauth', 'popup,width=600,height=760')
  if (!popup) window.location.href = githubUrl.value
}

function onPopupMessage(e: MessageEvent) {
  if (e.origin !== window.location.origin || e.source !== popup || e.data?.type !== 'knecht:reauth') return
  popup = null
  if (e.data.result === 'done') finish(true)
  else error.value = 'That GitHub account is not linked to you.'
}

onMounted(() => {
  window.addEventListener('message', onPopupMessage)
  const result = route.query.reauth
  if (result === 'done') toast.add({ title: 'Confirmed', description: 'Try the action again.', color: 'success' })
  if (result === 'mismatch') toast.add({ title: 'Could not confirm', description: 'That GitHub account is not linked to you.', color: 'error' })
  if (result) router.replace({ query: { ...route.query, reauth: undefined } })
})
onBeforeUnmount(() => window.removeEventListener('message', onPopupMessage))

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
        class="flex flex-col gap-5"
      >
        <UButton
          v-if="methods.github.username"
          icon="i-simple-icons-github"
          color="neutral"
          block
          class="justify-start"
          @click="confirmWithGithub"
        >
          Confirm with GitHub
          <template #trailing>
            <span class="ms-auto flex items-center gap-2">
              <KLastUsedBadge v-if="lastUsed === 'github'" />
              <UIcon
                name="i-lucide-arrow-right"
                class="size-4"
              />
            </span>
          </template>
        </UButton>
        <p
          v-if="error && !methods.password"
          class="-mt-3 text-sm text-error"
        >
          {{ error }}
        </p>
        <USeparator
          v-if="methods.password && methods.github.username"
          label="or"
        />
        <form
          v-if="methods.password"
          @submit.prevent="confirmPassword"
        >
          <UFormField
            label="Password"
            :error="error"
          >
            <template
              v-if="lastUsed === 'password'"
              #hint
            >
              <KLastUsedBadge />
            </template>
            <div class="flex gap-2">
              <KPasswordInput
                v-model="password"
                autocomplete="current-password"
                placeholder="Your password"
                autofocus
                class="flex-1"
              />
              <UButton
                type="submit"
                label="Confirm"
                :loading="confirming"
              />
            </div>
          </UFormField>
        </form>
      </div>
    </template>
  </UModal>
</template>
