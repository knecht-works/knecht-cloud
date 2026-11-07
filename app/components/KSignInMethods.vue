<script setup lang="ts">
defineProps<{
  methods: { password: boolean, github: { available: boolean, username: string | null } }
}>()
const emit = defineEmits<{ changed: [] }>()

const route = useRoute()
const router = useRouter()
const toast = useToast()
const toastError = useToastError()

onMounted(() => {
  const result = route.query.github
  if (result === 'linked') toast.add({ title: 'GitHub connected', color: 'success' })
  if (result === 'taken') toast.add({ title: 'Could not connect GitHub', description: 'This GitHub account belongs to another member.', color: 'error' })
  if (result) router.replace({ query: { ...route.query, github: undefined } })
})

const editingPassword = ref(false)
function passwordSaved() {
  emit('changed')
  toast.add({ title: 'Password saved', color: 'success' })
}

const disconnecting = ref(false)
async function disconnect() {
  disconnecting.value = true
  try {
    await $fetch('/api/me/identities/github', { method: 'DELETE' })
    emit('changed')
    toast.add({ title: 'GitHub disconnected', color: 'success' })
  }
  catch (e) {
    toastError('Could not disconnect GitHub', e)
  }
  finally {
    disconnecting.value = false
  }
}
</script>

<template>
  <div>
    <ul class="divide-y divide-default overflow-hidden rounded-lg border border-default">
      <li class="flex items-center gap-3.5 px-4 py-3.5">
        <UIcon
          name="i-lucide-key-round"
          class="size-5 flex-none text-muted"
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm text-highlighted">
            Password
          </div>
          <div class="text-xs text-muted">
            {{ methods.password ? 'Sign in with your username and password.' : 'Not set. Set one to sign in without GitHub.' }}
          </div>
        </div>
        <UButton
          :label="methods.password ? 'Change' : 'Set password'"
          color="neutral"
          variant="outline"
          size="sm"
          @click="editingPassword = true"
        />
      </li>

      <li
        v-if="methods.github.available || methods.github.username"
        class="flex items-center gap-3.5 px-4 py-3.5"
      >
        <UIcon
          name="i-simple-icons-github"
          class="size-5 flex-none text-muted"
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm text-highlighted">
            GitHub
          </div>
          <div class="truncate text-xs text-muted">
            {{ methods.github.username ? `Connected as @${methods.github.username}.` : 'Not connected.' }}
          </div>
        </div>
        <UTooltip
          v-if="methods.github.username"
          :text="methods.password ? undefined : 'GitHub is your only way to sign in. Set a password first.'"
          :disabled="methods.password"
        >
          <UButton
            label="Disconnect"
            color="neutral"
            variant="outline"
            size="sm"
            :loading="disconnecting"
            :disabled="!methods.password"
            @click="disconnect"
          />
        </UTooltip>
        <UButton
          v-else
          label="Connect"
          to="/auth/github?link=1"
          external
          color="neutral"
          variant="outline"
          size="sm"
        />
      </li>
    </ul>

    <KPasswordModal
      v-model:open="editingPassword"
      :has-password="methods.password"
      @saved="passwordSaved"
    />
  </div>
</template>
