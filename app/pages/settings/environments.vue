<script setup lang="ts">
import { SETTINGS_LIMITS } from '#shared/utils/settings-limits'
import type { DashboardSettings } from '~/composables/useSettings'

// Environments: the tunable lifecycle limits. Autosaves like before, but every
// field is validated against the server's bounds (SETTINGS_LIMITS) before a
// request is sent, and a refused value shows its reason at the field.
const { data: settings } = useSettings()

type EnvSettings = Pick<DashboardSettings, 'idleStopMinutes' | 'previewRetentionDays' | 'archiveRetentionDays' | 'maxConcurrentRuns'>
const form = reactive<EnvSettings>({ idleStopMinutes: 30, previewRetentionDays: 7, archiveRetentionDays: 30, maxConcurrentRuns: 2 })
const original = ref('')
function load() {
  if (!settings.value) return
  const { idleStopMinutes, previewRetentionDays, archiveRetentionDays, maxConcurrentRuns } = settings.value
  Object.assign(form, { idleStopMinutes, previewRetentionDays, archiveRetentionDays, maxConcurrentRuns })
  original.value = JSON.stringify({ ...form })
}
watch(settings, load, { immediate: true })

// Each field is one step down the preview lifecycle ladder (live → stopped →
// archived → deleted): "after how long of nobody touching it does a preview
// take the next step". The labels name the transition, not an internal state.
const ENV_FIELDS: { key: keyof EnvSettings, label: string, unit: string, hint: string }[] = [
  { key: 'idleStopMinutes', label: 'Live → stopped', unit: 'min', hint: 'Every live preview keeps a full environment running, eating server memory even when nobody looks at it. After this long without a visit it\'s stopped to free that memory. Opening it again brings it back in seconds, nothing is lost.' },
  { key: 'previewRetentionDays', label: 'Stopped → archived', unit: 'days', hint: 'A stopped preview untouched for this long is archived: the heavy environment is deleted, a small snapshot (database + code changes) is kept. Restoring takes a few minutes. 0 never archives.' },
  { key: 'archiveRetentionDays', label: 'Archived → deleted', unit: 'days', hint: 'An archive untouched for this long is deleted for good. After that, only running the workflow again boots the run. 0 never deletes.' },
  { key: 'maxConcurrentRuns', label: 'Parallel runs', unit: 'runs', hint: 'How many workflow runs may execute at the same time. Each boots a full isolated environment, so this caps the server load. Further runs queue and start as slots free up.' },
]

// An emptied number input is '' until retyped, so "whole number" catches it.
const errors = reactive<Record<keyof EnvSettings, string>>({ idleStopMinutes: '', previewRetentionDays: '', archiveRetentionDays: '', maxConcurrentRuns: '' })
function validate(): boolean {
  let ok = true
  for (const f of ENV_FIELDS) {
    const v = form[f.key]
    const { min, max } = SETTINGS_LIMITS[f.key]
    let msg = ''
    if (typeof v !== 'number' || !Number.isInteger(v)) msg = 'Enter a whole number.'
    else if (v < min) msg = `Must be at least ${min}.`
    else if (v > max) msg = `Must be at most ${max}.`
    errors[f.key] = msg
    if (msg) ok = false
  }
  return ok
}

// Autosave, debounced so a keystroke doesn't fire a request. Invalid values
// never leave the browser: the request is held until every field passes.
// `load()` refreshing `original` is what stops the save loop.
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveError = ref('')
let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(form, () => {
  if (JSON.stringify({ ...form }) === original.value) return
  saveError.value = ''
  clearTimeout(saveTimer)
  if (!validate()) {
    saveState.value = 'error'
    saveError.value = 'Not saved, check the values'
    return
  }
  saveState.value = 'saving'
  saveTimer = setTimeout(save, 800)
})
async function save() {
  if (!validate()) return
  try {
    settings.value = await $fetch<DashboardSettings>('/api/settings', { method: 'PATCH', body: { ...form } })
    load()
    saveState.value = 'saved'
  }
  catch (e) {
    saveState.value = 'error'
    saveError.value = errMsg(e, 'Not saved, check the values')
  }
}
</script>

<template>
  <KPanel
    title="Environments"
    icon="i-lucide-box"
  >
    <template #action>
      <KSaveStatus
        :state="saveState"
        :error-text="saveError"
      />
    </template>
    <p class="mb-5 text-2sm leading-relaxed text-muted">
      To free up the server, every run's preview steps down a ladder when nobody uses it:
      <span class="k-mono text-xs text-toned">live → stopped → archived → deleted</span>.
    </p>
    <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <div
        v-for="f in ENV_FIELDS"
        :key="f.key"
      >
        <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">{{ f.label }}</span>
        <div class="mt-2 flex items-center gap-2">
          <UInput
            v-model.number="form[f.key]"
            type="number"
            :min="SETTINGS_LIMITS[f.key].min"
            :max="SETTINGS_LIMITS[f.key].max"
            :color="errors[f.key] ? 'error' : undefined"
            :highlight="!!errors[f.key]"
            class="w-24"
          />
          <span class="k-mono text-2xs text-dimmed">{{ f.unit }}</span>
        </div>
        <p
          v-if="errors[f.key]"
          class="mt-2 text-xs leading-normal text-error"
        >
          {{ errors[f.key] }}
        </p>
        <p class="mt-2 text-xs leading-normal text-muted">
          {{ f.hint }}
        </p>
      </div>
    </div>
  </KPanel>
</template>
