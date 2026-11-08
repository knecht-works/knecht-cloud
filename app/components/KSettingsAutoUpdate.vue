<script setup lang="ts">
defineProps<{ editable: boolean }>()

const { data: settings } = useSettings()
const autoUpdateCron = ref('')
watch(settings, (s) => {
  if (s) autoUpdateCron.value = s.autoUpdateCron
}, { immediate: true })
const { state: saveState, error: saveError, schedule } = useAutosave(() =>
  patchSettings(settings, { autoUpdateCron: autoUpdateCron.value.trim() }))
watch(autoUpdateCron, () => {
  if (autoUpdateCron.value.trim() === (settings.value?.autoUpdateCron ?? '')) return
  schedule()
})
</script>

<template>
  <KPanel
    title="Automatic updates"
    icon="i-lucide-arrow-up-circle"
    accent="var(--primary)"
  >
    <template #action>
      <KSaveStatus
        :state="saveState"
        :error-text="saveError"
      />
    </template>
    <KSettingRow
      label="Schedule"
      :preset="isPreset(settings, 'autoUpdateCron')"
    >
      <template #hint>
        Cron in server time, installs only while no run is active.
        <span class="k-code">0 3 * * *</span> updates nightly at 03:00. Empty updates only via the
        <NuxtLink
          to="/system"
          class="text-toned underline underline-offset-2"
        >System</NuxtLink> page.
      </template>
      <UInput
        v-model="autoUpdateCron"
        placeholder="0 3 * * *"
        :disabled="!editable || isPreset(settings, 'autoUpdateCron')"
        aria-label="Automatic update schedule"
        class="w-full"
      />
    </KSettingRow>
  </KPanel>
</template>
