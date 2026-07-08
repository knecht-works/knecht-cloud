<script setup lang="ts">
import { AI_PROVIDERS, type AiProviderId } from '#shared/utils/ai'

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
// casing: normalise before comparing. `me` is the signed-in member's own row
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
  maxConcurrentRuns: number
  aiProvider: string
  aiModel: string
  /** Whether a provider API key is stored (the key itself never leaves the server). */
  aiKeyConfigured?: boolean
  /** Masked recognition preview of the stored key (first 8 + last 4 visible). */
  aiKeyPreview?: string
}
const { data: settings } = useFetch<Settings>('/api/settings', { lazy: true })

// Local editable copy of the ENV fields only: the Agent panel saves on its
// own (separate indicator), so a model change never flashes "Saving" over in
// Environments. Changes autosave shortly after the last edit.
type EnvSettings = Pick<Settings, 'idleStopMinutes' | 'previewRetentionDays' | 'archiveRetentionDays' | 'maxConcurrentRuns'>
const form = reactive<EnvSettings>({ idleStopMinutes: 30, previewRetentionDays: 7, archiveRetentionDays: 30, maxConcurrentRuns: 2 })
const aiProvider = ref<AiProviderId>('anthropic')
const aiModel = ref('anthropic/claude-sonnet-4-5')
const original = ref('')
function load() {
  if (!settings.value) return
  const { idleStopMinutes, previewRetentionDays, archiveRetentionDays, maxConcurrentRuns } = settings.value
  Object.assign(form, { idleStopMinutes, previewRetentionDays, archiveRetentionDays, maxConcurrentRuns })
  aiProvider.value = settings.value.aiProvider as AiProviderId
  aiModel.value = settings.value.aiModel
  original.value = JSON.stringify({ ...form })
}
watch(settings, load, { immediate: true })

// Each field is one step down the preview lifecycle ladder (live → stopped →
// archived → deleted): "after how long of nobody touching it does a preview
// take the next step". The labels name the transition, not an internal state.
const ENV_FIELDS: { key: keyof EnvSettings, label: string, unit: string, min: number, hint: string }[] = [
  { key: 'idleStopMinutes', label: 'Live → stopped', unit: 'min', min: 1, hint: 'Every live preview keeps a full environment running, eating server memory even when nobody looks at it. After this long without a visit it\'s stopped to free that memory. Opening it again brings it back in seconds, nothing is lost.' },
  { key: 'previewRetentionDays', label: 'Stopped → archived', unit: 'days', min: 0, hint: 'A stopped preview untouched for this long is archived: the heavy environment is deleted, a small snapshot (database + code changes) is kept. Restoring takes a few minutes. 0 never archives.' },
  { key: 'archiveRetentionDays', label: 'Archived → deleted', unit: 'days', min: 0, hint: 'An archive untouched for this long is deleted for good. After that, only running the workflow again boots the run. 0 never deletes.' },
  { key: 'maxConcurrentRuns', label: 'Parallel runs', unit: 'runs', min: 1, hint: 'How many workflow runs may execute at the same time. Each boots a full isolated environment, so this caps the server load. Further runs queue and start as slots free up.' },
]

// Autosave, debounced so a keystroke doesn't fire a request. An emptied number
// input is '' until retyped: hold off (keep "Saving…") rather than send an
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

// ── Agent: opencode provider key (write-only) + model catalog ────────────────
const { data: aiModels, status: aiModelsStatus, error: aiModelsError } = useAiModels()
const modelItems = computed(() =>
  aiModels.value.map(m => ({ label: m.id, description: `${m.name} · ${m.provider}`, id: m.id })))

const PROVIDER_ITEMS = AI_PROVIDERS.map(p => ({ label: p.label, id: p.id }))

// Provider and default model autosave like the env fields but report into the
// Agent panel's own indicator. load() writing server values back is a no-op
// here. A provider or key change refetches the (provider-scoped) catalog.
const agentSaveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
let agentSaveTimer: ReturnType<typeof setTimeout> | undefined
watch([aiProvider, aiModel], () => {
  if (aiProvider.value === settings.value?.aiProvider && aiModel.value === settings.value?.aiModel) return
  agentSaveState.value = 'saving'
  clearTimeout(agentSaveTimer)
  agentSaveTimer = setTimeout(saveAgent, 800)
})
async function saveAgent() {
  try {
    settings.value = await $fetch<Settings>('/api/settings', {
      method: 'PATCH',
      body: { aiProvider: aiProvider.value, aiModel: aiModel.value },
    })
    agentSaveState.value = 'saved'
    await refreshNuxtData('ai-models')
  }
  catch {
    agentSaveState.value = 'error'
  }
}

const aiKey = ref('')
const savingAiKey = ref(false)
async function saveAiKey() {
  if (!aiKey.value.trim()) return
  savingAiKey.value = true
  try {
    settings.value = await $fetch<Settings>('/api/settings', { method: 'PATCH', body: { aiKey: aiKey.value.trim() } })
    aiKey.value = ''
    await refreshNuxtData('ai-models')
  }
  catch (e) {
    toastError('Could not save the key', e)
  }
  finally {
    savingAiKey.value = false
  }
}

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

// ── GitHub webhook: the central app webhook GitHub triggers listen on ────────
interface WebhookStatus {
  configured: boolean
  endpoint: string | null
  secretConfigured: boolean
  settingsUrl: string | null
  github: {
    url: string | null
    urlConfigured: boolean
    events: { push: boolean, pull_request: boolean, issues: boolean }
    issuesPermission: boolean
  } | null
  ready: boolean
}
const { data: webhook } = useFetch<WebhookStatus>('/api/github/webhook-status', { lazy: true })

// ok: true = verified on GitHub, false = missing, null = unknown (GitHub
// unreachable). The three event subscriptions and the Issues permission can
// only be changed in the app's settings on GitHub, never via the API.
const webhookChecks = computed(() => {
  const w = webhook.value
  if (!w) return []
  return [
    { label: 'Secret stored', ok: w.secretConfigured, manual: false },
    { label: 'Webhook URL set on the app', ok: w.github ? w.github.urlConfigured : null, manual: false },
    { label: 'Event: push', ok: w.github ? w.github.events.push : null, manual: true },
    { label: 'Event: pull_request', ok: w.github ? w.github.events.pull_request : null, manual: true },
    { label: 'Event: issues', ok: w.github ? w.github.events.issues : null, manual: true },
    { label: 'Permission: Issues (read)', ok: w.github ? w.github.issuesPermission : null, manual: true },
  ]
})

// ── Cleanup: on-demand reconcile GC ──────────────────────────────────────────
// Reclaims leftovers whose DB row is gone (orphaned sandboxes, worktrees,
// archives, base clones, dump folders) plus superseded DB dumps. It also runs
// hourly on its own; this button is the "do it now" path.
interface GcResult { total: number }
const runningGc = ref(false)
async function runGc() {
  runningGc.value = true
  try {
    const { total } = await $fetch<GcResult>('/api/gc', { method: 'POST' })
    toast.add({
      title: total ? `Reclaimed ${total} orphaned item${total === 1 ? '' : 's'}` : 'Nothing to clean up',
      color: 'success',
    })
  }
  catch (e) {
    toastError('Cleanup failed', e)
  }
  finally {
    runningGc.value = false
  }
}
</script>

<template>
  <div>
    <KTopBar
      title="Settings"
      sub="Access, agent and environment configuration."
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
             still-empty card (dashed, with an inline input), so adding someone
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

      <KPanel
        title="Agent"
        icon="i-lucide-sparkles"
        accent="var(--accent-orange)"
        class="lg:col-span-2"
      >
        <template #action>
          <span
            v-if="agentSaveState !== 'idle'"
            class="k-mono text-[11px]"
            :class="agentSaveState === 'error' ? 'text-(--status-error)' : 'text-(--text-dimmed)'"
          >
            {{ agentSaveState === 'saving' ? 'Saving…' : agentSaveState === 'saved' ? 'Saved' : 'Not saved, check the value' }}
          </span>
          <span
            v-else
            class="k-mono text-[11px]"
            :class="settings?.aiKeyConfigured ? 'text-(--text-muted)' : 'text-(--text-dimmed)'"
          >
            {{ settings?.aiKeyConfigured ? 'Configured' : 'Not configured' }}
          </span>
        </template>
        <div class="flex gap-10">
          <div class="min-w-0 max-w-4xl flex-1">
            <p class="mb-5 text-[13px] leading-[1.6] text-(--text-muted)">
              The <span class="k-mono text-[12px] text-(--text-toned)">ai</span> workflow step
              runs opencode inside the run's sandbox, authenticated against the selected
              provider with this key. The key is stored encrypted, and each step can override
              the default model.
            </p>
            <div class="grid grid-cols-1 gap-5 sm:grid-cols-[13rem_1fr]">
              <div>
                <span class="k-mono text-[10.5px] uppercase tracking-[0.08em] text-(--text-dimmed)">Provider</span>
                <USelect
                  v-model="aiProvider"
                  :items="PROVIDER_ITEMS"
                  value-key="id"
                  class="mt-2 w-full"
                />
              </div>
              <div>
                <span class="k-mono text-[10.5px] uppercase tracking-[0.08em] text-(--text-dimmed)">API key</span>
                <form
                  class="mt-2 flex items-center gap-2"
                  @submit.prevent="saveAiKey"
                >
                  <UInput
                    v-model="aiKey"
                    type="password"
                    :placeholder="settings?.aiKeyPreview ?? (settings?.aiKeyConfigured ? 'Configured, enter a key to replace it' : 'sk-…')"
                    class="flex-1"
                  />
                  <UButton
                    type="submit"
                    color="primary"
                    size="xs"
                    label="Save"
                    :loading="savingAiKey"
                    :disabled="!aiKey.trim()"
                  />
                </form>
              </div>
              <div class="sm:col-span-2">
                <span class="k-mono text-[10.5px] uppercase tracking-[0.08em] text-(--text-dimmed)">Default model</span>
                <div class="mt-2">
                  <UInput
                    v-if="aiModelsError"
                    v-model="aiModel"
                    placeholder="anthropic/claude-sonnet-4-5"
                    class="w-full sm:max-w-md"
                  />
                  <USelectMenu
                    v-else
                    v-model="aiModel"
                    :items="modelItems"
                    value-key="id"
                    :filter-fields="['label', 'description']"
                    :loading="aiModelsStatus === 'pending'"
                    placeholder="anthropic/claude-sonnet-4-5"
                    class="w-full sm:max-w-md"
                  />
                </div>
                <p class="mt-2 text-[12px] leading-[1.5] text-(--text-muted)">
                  Only the selected provider's models are offered. For OpenCode the list comes
                  from your workspace, so models disabled there don't show up.
                </p>
              </div>
            </div>
          </div>
          <img
            src="/mascot/looking-right-knecht.svg"
            alt=""
            class="pointer-events-none ml-auto hidden h-52 w-auto shrink-0 self-center -scale-x-100 xl:mr-6 xl:block"
          >
        </div>
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

      <KPanel
        title="GitHub webhook"
        icon="i-simple-icons-github"
        class="lg:col-span-2"
      >
        <template #action>
          <span
            class="k-mono text-[11px]"
            :class="webhook?.ready ? 'text-(--primary)' : 'text-(--text-dimmed)'"
          >
            {{ webhook ? (webhook.ready ? 'Ready' : 'Needs attention') : 'Checking…' }}
          </span>
        </template>

        <p class="mb-5 max-w-3xl text-[13px] leading-[1.6] text-(--text-muted)">
          GitHub triggers receive push, pull request and issue events through the GitHub App's
          own webhook. It is configured automatically when the app is created during setup, so
          connected repos need no per-repo webhook setup. If a check fails, fix it in the
          <a
            v-if="webhook?.settingsUrl"
            :href="webhook.settingsUrl"
            target="_blank"
            class="text-(--text-toned) underline underline-offset-2"
          >app's settings</a><span v-else>app's settings</span>
          (General → Webhook, Permissions &amp; events).
        </p>

        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="c in webhookChecks"
            :key="c.label"
            class="flex items-center gap-2.5 rounded-(--radius-md) border border-(--border-muted) bg-(--surface-muted) px-3 py-2.5"
          >
            <UIcon
              :name="c.ok === true ? 'i-lucide-check-circle-2' : c.ok === false ? 'i-lucide-circle' : 'i-lucide-circle-help'"
              class="size-4 flex-none"
              :class="c.ok === true ? 'text-(--primary)' : 'text-(--text-dimmed)'"
            />
            <span class="min-w-0 flex-1 truncate text-[12.5px] text-(--text-muted)">{{ c.label }}</span>
            <span
              v-if="c.manual && c.ok !== true"
              class="k-mono flex-none text-[10.5px] text-(--text-dimmed)"
            >on GitHub</span>
          </div>
        </div>

        <p
          v-if="webhook?.github?.url && webhook.github.url !== webhook.endpoint"
          class="k-mono mt-3 text-[11px] leading-[1.5] text-(--text-dimmed)"
        >
          The app's webhook points at {{ webhook.github.url }}. That's fine when a forwarder
          (e.g. smee) relays to this instance; otherwise fix the URL in the app settings.
        </p>

        <p class="k-mono mt-5 max-w-2xl text-[11px] leading-[1.5] text-(--text-dimmed)">
          {{ webhook?.endpoint ?? 'Set KNECHT_BASE_DOMAIN so the webhook URL can be built.' }}
        </p>
      </KPanel>

      <KPanel
        title="Cleanup"
        icon="i-lucide-trash-2"
        class="lg:col-span-2"
      >
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="max-w-2xl text-[13px] leading-[1.6] text-(--text-muted)">
            Reclaims leftovers whose run or project is already gone: orphaned sandboxes, worktrees,
            archives, base clones and dump folders, plus superseded database dumps. This runs
            automatically every hour; use the button to run it now.
          </p>
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="subtle"
            label="Run cleanup now"
            :loading="runningGc"
            class="flex-none"
            @click="runGc"
          />
        </div>
      </KPanel>
    </div>
  </div>
</template>
