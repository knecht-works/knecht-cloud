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
    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      <div class="flex items-center gap-3 rounded-lg border border-default bg-(--surface-muted) px-3.5 py-3">
        <UIcon
          name="i-lucide-key-round"
          class="size-5 flex-none text-dimmed"
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm text-toned">
            Password
          </div>
          <div class="k-mono text-2xs text-dimmed">
            {{ methods.password ? 'set' : 'not set' }}
          </div>
        </div>
        <UButton
          :label="methods.password ? 'Change' : 'Set'"
          color="neutral"
          :variant="methods.password ? 'ghost' : 'subtle'"
          size="xs"
          @click="editingPassword = true"
        />
      </div>

      <div
        v-if="methods.github.available || methods.github.username"
        class="flex items-center gap-3 rounded-lg border border-default bg-(--surface-muted) px-3.5 py-3"
      >
        <UIcon
          name="i-simple-icons-github"
          class="size-5 flex-none text-dimmed"
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm text-toned">
            GitHub
          </div>
          <div class="k-mono truncate text-2xs text-dimmed">
            {{ methods.github.username ? `@${methods.github.username}` : 'not connected' }}
          </div>
        </div>
        <UTooltip
          v-if="methods.github.username"
          :text="methods.password ? 'Disconnect GitHub' : 'Your only way to sign in'"
        >
          <UButton
            label="Disconnect"
            color="neutral"
            variant="ghost"
            size="xs"
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
          variant="subtle"
          size="xs"
        />
      </div>
    </div>

    <KPasswordModal
      v-model:open="editingPassword"
      :has-password="methods.password"
      @saved="passwordSaved"
    />
  </div>
</template>
