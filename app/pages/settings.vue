<script setup lang="ts">
const { user, clear } = useUserSession()
const toast = useToast()
const toastError = useToastError()

// ── Access: your account + the login allowlist ────────────────────────────────
interface Member {
  login: string
  name: string | null
  avatarUrl: string | null
  isOwner: boolean
}
const { data: members } = await useFetch<Member[]>('/api/members')

// Member logins are stored lowercased; the session login keeps GitHub's original
// casing — normalise before comparing. `me` is the signed-in member's own row
// (always present: the /api gate only lets members through); `others` is the
// rest of the team.
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

// ── Environments: tunable lifecycle limits ────────────────────────────────────
interface Settings {
  idleStopMinutes: number
  previewRetentionDays: number
  archiveRetentionDays: number
}
const { data: settings } = useFetch<Settings>('/api/settings', { lazy: true })

// Local editable copy; changes autosave shortly after the last edit.
const form = reactive<Settings>({ idleStopMinutes: 30, previewRetentionDays: 7, archiveRetentionDays: 30 })
const original = ref('')
function load() {
  if (!settings.value) return
  Object.assign(form, settings.value)
  original.value = JSON.stringify(settings.value)
}
watch(settings, load, { immediate: true })

// Each field is one step down the preview lifecycle ladder (live → stopped →
// archived → deleted): "after how long of nobody touching it does a preview
// take the next step". The labels name the transition, not an internal state.
const ENV_FIELDS: { key: keyof Settings, label: string, unit: string, min: number, hint: string }[] = [
  { key: 'idleStopMinutes', label: 'Live → stopped', unit: 'min', min: 1, hint: 'Every live preview keeps a full environment running, eating server memory even when nobody looks at it. After this long without a visit it\'s stopped to free that memory. Opening it again brings it back in seconds, nothing is lost.' },
  { key: 'previewRetentionDays', label: 'Stopped → archived', unit: 'days', min: 0, hint: 'A stopped preview untouched for this long is archived: the heavy environment is deleted, a small snapshot (database + code changes) is kept. Restoring takes a few minutes. 0 never archives.' },
  { key: 'archiveRetentionDays', label: 'Archived → deleted', unit: 'days', min: 0, hint: 'An archive untouched for this long is deleted for good. After that, only running the workflow again boots the run. 0 never deletes.' },
]

// Autosave, debounced so a keystroke doesn't fire a request. An emptied number
// input is '' until retyped — hold off (keep "Saving…") rather than send an
// invalid body; out-of-range values are the server's call and surface as the
// error state. `load()` refreshing `original` is what stops the save loop.
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(form, () => {
  if (JSON.stringify({ ...form }) === original.value) return
  saveState.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 800)
})

async function save() {
  if (!ENV_FIELDS.every(f => Number.isInteger(form[f.key]))) return
  try {
    settings.value = await $fetch<Settings>('/api/settings', { method: 'PATCH', body: { ...form } })
    load()
    saveState.value = 'saved'
  }
  catch {
    saveState.value = 'error'
  }
}
</script>

<template>
  <div>
    <KTopBar
      title="Settings"
      sub="Access, host environment and agent configuration."
    >
      <template #actions>
        <AppSearch />
      </template>
    </KTopBar>

    <div class="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
      <KPanel
        title="Access"
        icon="i-lucide-users"
        class="lg:col-span-2"
      >
        <template #action>
          <span class="k-mono text-[11px] text-(--text-dimmed)">
            {{ members?.length ?? 0 }} {{ (members?.length ?? 0) === 1 ? 'member' : 'members' }}
          </span>
        </template>

        <!-- One compact card per person in a grid, so the panel's full width is
             used instead of one person per full-width row. You come first (with
             sign-out where your account is); the invite form is the grid's
             still-empty card — dashed, with an inline input — so adding someone
             reads as "filling the next slot". -->
        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          <div class="flex items-center gap-3 rounded-(--radius-lg) border border-(--border-default) bg-(--surface-muted) px-3.5 py-3">
            <UAvatar
              :src="user?.avatarUrl"
              :alt="user?.login"
              size="sm"
              class="flex-none"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm text-(--text-toned)">{{ user?.name || user?.login }}</span>
                <UBadge
                  :color="me?.isOwner ? 'primary' : 'neutral'"
                  variant="subtle"
                  size="sm"
                  :label="me?.isOwner ? 'Owner' : 'You'"
                />
              </div>
              <div class="k-mono text-[11.5px] text-(--text-dimmed)">
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
            class="flex items-center gap-3 rounded-(--radius-lg) border border-(--border-default) bg-(--surface-muted) px-3.5 py-3"
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
                  color="primary"
                  variant="subtle"
                  size="sm"
                  label="Owner"
                />
              </div>
              <div class="k-mono text-[11.5px] text-(--text-dimmed)">
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
            class="flex items-center gap-3 rounded-(--radius-lg) border border-dashed border-(--border-default) px-3.5 py-3"
            @submit.prevent="invite"
          >
            <span class="flex size-7 flex-none items-center justify-center rounded-full border border-dashed border-(--border-default) text-(--text-dimmed)">
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

      <SystemPanel />

      <KPanel
        title="Agent"
        icon="i-lucide-sparkles"
        accent="var(--accent-orange)"
      >
        <template #action>
          <span class="k-mono text-[11px] text-(--text-dimmed)">Planned</span>
        </template>
        <p class="text-[13px] text-(--text-muted)">
          OpenRouter key, model selection and run limits will live here. Not wired up yet.
        </p>
      </KPanel>

      <KPanel
        title="Environments"
        icon="i-lucide-box"
        class="lg:col-span-2"
      >
        <template #action>
          <span
            v-if="saveState !== 'idle'"
            class="k-mono text-[11px]"
            :class="saveState === 'error' ? 'text-(--status-error)' : 'text-(--text-dimmed)'"
          >
            {{ saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Not saved, check the values' }}
          </span>
        </template>
        <p class="mb-5 text-[13px] leading-[1.6] text-(--text-muted)">
          To free up the server, every run's preview steps down a ladder when nobody uses it:
          <span class="k-mono text-[12px] text-(--text-toned)">live → stopped → archived → deleted</span>.
        </p>
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
                :min="f.min"
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
    </div>
  </div>
</template>
