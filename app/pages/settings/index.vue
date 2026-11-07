<script setup lang="ts">
const { user, clear } = useUserSession()
const toast = useToast()
const toastError = useToastError()

const { data: members } = await useMembers()

const me = computed(() => members.value?.find(m => m.id === user.value?.id))
const others = computed(() => members.value?.filter(m => m.id !== user.value?.id) ?? [])

async function logout() {
  await clear()
  await navigateTo('/login')
}

const { data: invites, refresh: refreshInvites } = await useFetch('/api/invites', { default: () => [] })
// The server keeps only a hash, so a link can be copied only in the tab that created it.
const inviteUrls = ref<Record<number, string>>({})
const inviting = ref(false)
async function invite() {
  inviting.value = true
  try {
    const { invite, token } = await $fetch('/api/invites', { method: 'POST' })
    inviteUrls.value[invite.id] = `${window.location.origin}/join/${token}`
    await refreshInvites()
    await copyInvite(invite.id)
  }
  catch (e) {
    toastError('Could not create the invite link', e)
  }
  finally {
    inviting.value = false
  }
}

async function copyInvite(id: number) {
  try {
    await copyText(inviteUrls.value[id]!)
    toast.add({ title: 'Invite link copied', description: 'It works for one person and expires in 7 days.', color: 'success' })
  }
  catch {
    toast.add({ title: 'Could not copy the invite link', description: inviteUrls.value[id], color: 'warning' })
  }
}

function expiresIn(at: string): string {
  const days = Math.ceil((new Date(at).getTime() - Date.now()) / 86_400_000)
  return days > 1 ? `in ${days} days` : 'within a day'
}

const revoking = ref<number | null>(null)
async function revoke(id: number) {
  revoking.value = id
  try {
    invites.value = await $fetch(`/api/invites/${id}`, { method: 'DELETE' })
  }
  catch (e) {
    toastError('Could not revoke the invite link', e)
  }
  finally {
    revoking.value = null
  }
}

const removing = ref('')
async function remove(login: string) {
  removing.value = login
  try {
    members.value = await $fetch(`/api/members/${login}`, { method: 'DELETE' })
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
          :src="user?.avatarUrl ?? undefined"
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

      <div
        v-for="i in invites"
        :key="`invite-${i.id}`"
        class="flex items-center gap-3 rounded-lg border border-dashed border-default px-3.5 py-3"
      >
        <span class="flex size-7 flex-none items-center justify-center rounded-full border border-dashed border-default text-dimmed">
          <UIcon
            name="i-lucide-link"
            class="size-3.5"
          />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm text-toned">Invite link</span>
            <UBadge
              color="neutral"
              variant="subtle"
              size="sm"
              label="Pending"
            />
          </div>
          <div class="k-mono truncate text-2xs text-dimmed">
            expires {{ expiresIn(i.expiresAt) }}<template v-if="i.createdBy">
              · @{{ i.createdBy }}
            </template>
          </div>
        </div>
        <UTooltip
          v-if="inviteUrls[i.id]"
          text="Copy link"
        >
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Copy invite link"
            @click="copyInvite(i.id)"
          />
        </UTooltip>
        <UTooltip text="Revoke">
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            :loading="revoking === i.id"
            aria-label="Revoke invite link"
            @click="revoke(i.id)"
          />
        </UTooltip>
      </div>

      <button
        type="button"
        class="flex items-center gap-3 rounded-lg border border-dashed border-default px-3.5 py-3 text-left text-sm text-muted hover:text-toned disabled:opacity-60"
        :disabled="inviting"
        @click="invite"
      >
        <span class="flex size-7 flex-none items-center justify-center rounded-full border border-dashed border-default text-dimmed">
          <UIcon
            :name="inviting ? 'i-lucide-loader-circle' : 'i-lucide-plus'"
            class="size-3.5"
            :class="{ 'animate-spin': inviting }"
          />
        </span>
        Create invite link
      </button>
    </div>
  </KPanel>
</template>
