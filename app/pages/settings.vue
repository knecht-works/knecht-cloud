<script setup lang="ts">
const { user } = useUserSession()
const toast = useToast()

interface Settings {
  idleStopMinutes: number
  maxConcurrentEnvs: number
  teardownStoppedMinutes: number
}

const { data: settings } = await useFetch<Settings>('/api/settings')

// Members — the login allowlist. Every member has full access; the owner can't
// be removed.
interface Member {
  login: string
  name: string | null
  avatarUrl: string | null
  isOwner: boolean
}
const { data: members } = await useFetch<Member[]>('/api/members')

// Member logins are stored lowercased; the session login keeps GitHub's
// original casing — normalise before comparing.
const myLogin = computed(() => user.value?.login.toLowerCase())

const errMsg = (e: unknown) => (e as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Please try again.'

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
    toast.add({ title: 'Could not invite', description: errMsg(e), color: 'error' })
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
    toast.add({ title: 'Could not remove', description: errMsg(e), color: 'error' })
  }
  finally {
    removing.value = ''
  }
}

// Local editable copy + dirty tracking.
const form = reactive<Settings>({ idleStopMinutes: 30, maxConcurrentEnvs: 5, teardownStoppedMinutes: 180 })
const original = ref('')
function load() {
  if (!settings.value) return
  Object.assign(form, settings.value)
  original.value = JSON.stringify(settings.value)
}
watch(settings, load, { immediate: true })
const dirty = computed(() => JSON.stringify({ idleStopMinutes: form.idleStopMinutes, maxConcurrentEnvs: form.maxConcurrentEnvs, teardownStoppedMinutes: form.teardownStoppedMinutes }) !== original.value)

const ENV_FIELDS: { key: keyof Settings, label: string, unit: string, hint: string }[] = [
  { key: 'maxConcurrentEnvs', label: 'Max concurrent previews', unit: 'envs', hint: 'Most environments kept running at once. Booting more first stops the least-recently-viewed — keeps Docker from running out of networks.' },
  { key: 'idleStopMinutes', label: 'Idle stop', unit: 'min', hint: 'Stop an environment after this long without a preview view. Volumes are kept, so reopening reboots it quickly.' },
  { key: 'teardownStoppedMinutes', label: 'Delete stopped after', unit: 'min', hint: 'Fully remove a stopped environment (and its volumes) once untouched this long. 0 keeps it until the run is deleted.' },
]

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    settings.value = await $fetch<Settings>('/api/settings', { method: 'PATCH', body: { ...form } })
    load()
    toast.add({ title: 'Settings saved', color: 'success' })
  }
  catch {
    toast.add({ title: 'Failed to save settings', color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <KTopBar
      title="Settings"
      sub="Account, host environment and agent configuration."
    >
      <template #actions>
        <AppSearch />
      </template>
    </KTopBar>

    <div class="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
      <KPanel
        title="Account"
        icon="i-simple-icons-github"
      >
        <div class="flex items-center gap-3.5">
          <UAvatar
            :src="user?.avatarUrl"
            :alt="user?.login"
            size="lg"
            class="flex-none"
          />
          <div class="min-w-0">
            <div class="text-sm text-(--text-toned)">
              {{ user?.name || user?.login }}
            </div>
            <div class="k-mono text-[11.5px] text-(--text-dimmed)">
              @{{ user?.login }}
            </div>
          </div>
        </div>
      </KPanel>

      <SystemPanel />

      <KPanel
        title="Members"
        icon="i-lucide-users"
        class="lg:col-span-2"
      >
        <div class="divide-y divide-(--border-muted)">
          <div
            v-for="m in members"
            :key="m.login"
            class="flex items-center gap-3 py-2.5 first:pt-0"
          >
            <UAvatar
              :src="m.avatarUrl ?? undefined"
              :alt="m.login"
              size="sm"
              class="flex-none"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm text-(--text-toned)">{{ m.name || m.login }}</span>
                <UBadge
                  v-if="m.isOwner"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  label="Owner"
                />
                <UBadge
                  v-else-if="m.login === myLogin"
                  color="primary"
                  variant="subtle"
                  size="sm"
                  label="You"
                />
              </div>
              <div class="k-mono text-[11.5px] text-(--text-dimmed)">
                @{{ m.login }}
              </div>
            </div>
            <UButton
              v-if="!m.isOwner && m.login !== myLogin"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              :loading="removing === m.login"
              :aria-label="`Remove ${m.login}`"
              @click="remove(m.login)"
            />
          </div>
        </div>

        <form
          class="mt-4 flex gap-2"
          @submit.prevent="invite"
        >
          <UInput
            v-model="newLogin"
            placeholder="GitHub username"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            class="flex-1"
            :disabled="inviting"
          />
          <UButton
            type="submit"
            label="Invite"
            icon="i-simple-icons-github"
            color="neutral"
            :loading="inviting"
            :disabled="!newLogin.trim()"
          />
        </form>
        <p class="mt-2.5 text-[12px] leading-[1.5] text-(--text-muted)">
          Invited users sign in with GitHub and currently have the same full access as the owner.
        </p>
      </KPanel>

      <KPanel
        title="Environments"
        icon="i-lucide-box"
        class="lg:col-span-2"
      >
        <template #action>
          <UButton
            color="primary"
            size="sm"
            label="Save"
            :loading="saving"
            :disabled="!dirty"
            @click="save"
          />
        </template>
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div
            v-for="f in ENV_FIELDS"
            :key="f.key"
          >
            <span class="k-mono text-[10.5px] uppercase tracking-[0.08em] text-(--text-dimmed)">{{ f.label }}</span>
            <div class="mt-2 flex items-center gap-2">
              <UInput
                v-model.number="form[f.key]"
                type="number"
                :min="0"
                class="w-24"
              />
              <span class="k-mono text-[11.5px] text-(--text-dimmed)">{{ f.unit }}</span>
            </div>
            <p class="mt-2 text-[12px] leading-[1.5] text-(--text-muted)">
              {{ f.hint }}
            </p>
          </div>
        </div>
      </KPanel>

      <KPanel
        title="Agent"
        icon="i-lucide-sparkles"
        accent="var(--accent-orange)"
        class="lg:col-span-2"
      >
        <template #action>
          <span class="k-mono text-[11px] text-(--text-dimmed)">Planned</span>
        </template>
        <p class="text-[13px] text-(--text-muted)">
          OpenRouter key, model selection and run limits will live here. Not wired up yet.
        </p>
      </KPanel>
    </div>
  </div>
</template>
