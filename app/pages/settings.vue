<script setup lang="ts">
const { user } = useUserSession()
const toast = useToast()

interface Settings {
  idleStopMinutes: number
  maxConcurrentEnvs: number
  teardownStoppedMinutes: number
}

const { data: settings } = await useFetch<Settings>('/api/settings')

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
