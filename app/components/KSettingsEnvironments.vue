<script setup lang="ts">
import { SETTINGS_LIMITS } from '#shared/utils/settings-limits'
import type { DashboardSettings } from '~/composables/useSettings'

defineProps<{ editable: boolean }>()

const { data: settings } = useSettings()
const { withElevation } = useElevation()

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

const ENV_FIELDS: { key: keyof EnvSettings, label: string, unit: string, hint: string }[] = [
  { key: 'idleStopMinutes', label: 'Live → stopped', unit: 'min', hint: 'An unused live session still holds a container and server memory. After this long it\'s stopped. Opening it again takes seconds, nothing is lost.' },
  { key: 'previewRetentionDays', label: 'Stopped → archived', unit: 'days', hint: 'Checkout and containers are deleted, a small snapshot of the code changes (and a preview\'s database) is kept. Restoring a preview takes a few minutes. 0 never archives.' },
  { key: 'archiveRetentionDays', label: 'Archived → deleted', unit: 'days', hint: 'The archive is deleted for good. Only running the workflow again brings the run back. 0 never deletes.' },
  { key: 'maxConcurrentRuns', label: 'Parallel runs', unit: 'runs', hint: 'How many workflow runs execute at the same time, each in its own container. Further runs queue until a slot frees up.' },
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

const { state: saveState, error: saveError, schedule, invalid } = useAutosave(async () => {
  await withElevation(() => patchSettings(settings, { ...form }))
  original.value = JSON.stringify({ ...form })
})
watch(form, () => {
  if (JSON.stringify({ ...form }) === original.value) return
  if (!validate()) return invalid('Not saved, check the values')
  schedule()
})
</script>

<template>
  <KPanel
    title="Environments"
    icon="i-lucide-box"
    accent="var(--primary)"
  >
    <template #action>
      <KSaveStatus
        :state="saveState"
        :error-text="saveError"
      />
    </template>
    <p class="mb-2.5 max-w-3xl text-xs leading-relaxed text-muted">
      To free up the server, every session steps down a ladder when nobody uses it:
      <span class="k-code">live → stopped → archived → deleted</span>.
    </p>
    <KSettingRow
      v-for="f in ENV_FIELDS"
      :key="f.key"
      :label="f.label"
      :hint="f.hint"
      :preset="isPreset(settings, f.key)"
    >
      <div class="flex items-center gap-2">
        <UInput
          v-model.number="form[f.key]"
          type="number"
          :min="SETTINGS_LIMITS[f.key].min"
          :max="SETTINGS_LIMITS[f.key].max"
          :disabled="!editable || isPreset(settings, f.key)"
          :color="errors[f.key] ? 'error' : undefined"
          :highlight="!!errors[f.key]"
          class="flex-1"
        />
        <span class="w-9 text-xs text-highlighted">{{ f.unit }}</span>
      </div>
      <p
        v-if="errors[f.key]"
        class="mt-2 text-xs leading-normal text-error"
      >
        {{ errors[f.key] }}
      </p>
    </KSettingRow>
  </KPanel>
</template>
