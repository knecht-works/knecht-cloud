<script setup lang="ts">
import { SETTINGS_LIMITS } from '#shared/utils/settings-limits'
import { shareLinkMaxMinutes, type PreviewAccess } from '#shared/utils/preview-access'

// With a project it edits that project's overrides, where null means the global default.
const props = defineProps<{
  editable: boolean
  project?: { id: number, previewAccess: PreviewAccess | null, shareLinkHours: number | null }
}>()

const { data: settings } = useSettings()

interface PreviewForm { access: PreviewAccess | null, hours: number | null }
const source = computed<PreviewForm | null>(() => {
  if (props.project) return { access: props.project.previewAccess, hours: props.project.shareLinkHours }
  return settings.value ? { access: settings.value.previewAccess, hours: settings.value.shareLinkHours } : null
})
const form = reactive<PreviewForm>({ access: null, hours: null })
const original = ref('')
watch(source, (s) => {
  if (!s) return
  Object.assign(form, s)
  original.value = JSON.stringify(s)
}, { immediate: true })

const accessLabel = (access: PreviewAccess | undefined) => access === 'public' ? 'Public' : 'Login required'
const accessItems = computed(() => [
  ...(props.project ? [{ label: `Global default (${accessLabel(settings.value?.previewAccess).toLowerCase()})`, value: 'inherit' }] : []),
  { label: accessLabel('login'), value: 'login' },
  { label: accessLabel('public'), value: 'public' },
])

const maxHours = computed(() => settings.value ? Math.floor(shareLinkMaxMinutes(settings.value) / 60) : SETTINGS_LIMITS.shareLinkHours.max)
const globalHoursLabel = computed(() => settings.value?.shareLinkHours ?? `as long as possible (${maxHours.value})`)
const hoursError = computed(() => {
  const v = form.hours
  if (v === null) return ''
  if (!Number.isInteger(v)) return 'Enter a whole number.'
  if (v < SETTINGS_LIMITS.shareLinkHours.min) return `Must be at least ${SETTINGS_LIMITS.shareLinkHours.min}.`
  if (v > maxHours.value) return `Must be at most ${maxHours.value}, the live and stopped time of a session.`
  return ''
})

const preset = (key: string) => !props.project && isPreset(settings.value, key)

const { state: saveState, error: saveError, schedule, invalid } = useAutosave(async () => {
  if (props.project) {
    await $fetch(`/api/projects/${props.project.id}`, { method: 'PATCH', body: { previewAccess: form.access, shareLinkHours: form.hours } })
  }
  else {
    await patchSettings(settings, { previewAccess: form.access ?? 'login', shareLinkHours: form.hours })
  }
  original.value = JSON.stringify({ ...form })
})
watch(form, () => {
  if (JSON.stringify({ ...form }) === original.value) return
  if (hoursError.value) return invalid('Not saved, check the values')
  schedule()
})
</script>

<template>
  <KPanel
    title="Previews"
    icon="i-lucide-eye"
    accent="var(--primary)"
  >
    <template #action>
      <KSaveStatus
        :state="saveState"
        :error-text="saveError"
      />
    </template>
    <KSettingRow
      label="Access"
      :hint="project
        ? 'Whether this project\'s previews need a login. Share links work either way. The IDE and services always require a login.'
        : 'Who can open a preview. Public previews open for anyone with the URL. A project can override this in its settings. The IDE and services always require a login.'"
      :preset="preset('previewAccess')"
    >
      <USelect
        :model-value="form.access ?? 'inherit'"
        :items="accessItems"
        :disabled="!editable || preset('previewAccess')"
        class="w-full"
        @update:model-value="form.access = $event === 'inherit' ? null : $event as PreviewAccess"
      />
    </KSettingRow>
    <KSettingRow
      label="Share links"
      :hint="project
        ? 'How long a copied share link lets people in without a login. Empty uses the global default.'
        : 'How long a copied share link lets people in without a login. Copying it again starts the time over. Empty means as long as possible: the live and stopped time together, so a stopped preview starts again in seconds when someone opens the link.'"
      :preset="preset('shareLinkHours')"
    >
      <KUnitInput
        :model-value="form.hours ?? undefined"
        unit="h"
        :min="SETTINGS_LIMITS.shareLinkHours.min"
        :max="maxHours"
        :placeholder="project ? `Global default: ${globalHoursLabel}` : `As long as possible (${maxHours})`"
        :disabled="!editable || preset('shareLinkHours')"
        :color="hoursError ? 'error' : undefined"
        :highlight="!!hoursError"
        class="w-full"
        @update:model-value="form.hours = typeof $event === 'number' ? $event : null"
      />
      <p
        v-if="hoursError"
        class="mt-2 text-xs leading-normal text-error"
      >
        {{ hoursError }}
      </p>
    </KSettingRow>
  </KPanel>
</template>
