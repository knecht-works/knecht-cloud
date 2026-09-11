<script setup lang="ts">
const { user, clear } = useUserSession()
const toast = useToast()
const toastError = useToastError()

interface Member {
  login: string
  name: string | null
  avatarUrl: string | null
  isOwner: boolean
}
const { data: members } = await useFetch<Member[]>('/api/members')

// Member logins are stored lowercased; the session login keeps GitHub's casing.
const myLogin = computed(() => user.value?.login.toLowerCase())
const me = computed(() => members.value?.find(m => m.login === myLogin.value))
const others = computed(() => members.value?.filter(m => m.login !== myLogin.value) ?? [])

async function logout() {
  await clear()
  await navigateTo('/login')
}

const newLogin = ref('')
const inviting = ref(false)
async function invite() {
  const login = newLogin.value.trim()
  if (!login) return
  inviting.value = true
  try {
    members.value = await $fetch<Member[]>('/api/members', { method: 'POST', body: { login } })
    newLogin.value = ''
    toast.add({ title: `Invited @${login}`, color: 'success' })
  }
  catch (e) {
    toastError('Could not invite', e)
  }
  finally {
    inviting.value = false
  }
}

const removing = ref('')
async function remove(login: string) {
  removing.value = login
  try {
    members.value = await $fetch<Member[]>(`/api/members/${login}`, { method: 'DELETE' })
    toast.add({ title: `Removed @${login}`, color: 'success' })
  }
  catch (e) {
    toastError('Could not remove', e)
  }
  finally {
    removing.value = ''
  }
}
</script>

<template>
  <KPanel
    title="Access"
    icon="i-lucide-users"
    accent="var(--primary)"
  >
    <template #action>
      <span class="k-mono text-2xs text-dimmed">
        {{ members?.length ?? 0 }} {{ (members?.length ?? 0) === 1 ? 'member' : 'members' }}
      </span>
    </template>

    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      <div class="flex items-center gap-3 rounded-lg border border-default bg-(--surface-muted) px-3.5 py-3">
        <UAvatar
          :src="user?.avatarUrl"
          :alt="user?.login"
          size="sm"
          class="flex-none"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm text-toned">{{ user?.name || user?.login }}</span>
            <UBadge
              :color="me?.isOwner ? 'primary' : 'neutral'"
              variant="subtle"
              size="sm"
              :label="me?.isOwner ? 'Owner' : 'You'"
            />
          </div>
          <div class="k-mono text-2xs text-dimmed">
            @{{ user?.login }}
          </div>
        </div>
        <UTooltip text="Sign out">
          <UButton
            icon="i-lucide-log-out"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Sign out"
            @click="logout"
          />
        </UTooltip>
      </div>

      <div
        v-for="m in others"
        :key="m.login"
        class="flex items-center gap-3 rounded-lg border border-default bg-(--surface-muted) px-3.5 py-3"
      >
        <UAvatar
          :src="m.avatarUrl ?? undefined"
          :alt="m.login"
          size="sm"
          class="flex-none"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm text-toned">{{ m.name || m.login }}</span>
            <UBadge
              v-if="m.isOwner"
              color="primary"
              variant="subtle"
              size="sm"
              label="Owner"
            />
          </div>
          <div class="k-mono text-2xs text-dimmed">
            @{{ m.login }}
          </div>
        </div>
        <UTooltip
          v-if="!m.isOwner"
          text="Remove"
        >
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            :loading="removing === m.login"
            :aria-label="`Remove ${m.login}`"
            @click="remove(m.login)"
          />
        </UTooltip>
      </div>

      <form
        class="flex items-center gap-3 rounded-lg border border-dashed border-default px-3.5 py-3"
        @submit.prevent="invite"
      >
        <span class="flex size-7 flex-none items-center justify-center rounded-full border border-dashed border-default text-dimmed">
          <UIcon
            name="i-lucide-plus"
            class="size-3.5"
          />
        </span>
        <UInput
          v-model="newLogin"
          placeholder="GitHub username…"
          variant="none"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          :disabled="inviting"
          class="min-w-0 flex-1"
          :ui="{ base: 'px-0 text-sm' }"
        />
        <UButton
          type="submit"
          label="Invite"
          color="primary"
          size="xs"
          :loading="inviting"
          :disabled="!newLogin.trim()"
        />
      </form>
    </div>
  </KPanel>
</template>
