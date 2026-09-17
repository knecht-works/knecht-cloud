<script setup lang="ts">
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
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <p class="max-w-2xl text-2sm leading-relaxed text-muted">
        Installs new releases on this schedule (cron, server time), only while
        no run is active. For example <span class="k-mono text-xs text-toned">0 3 * * *</span>
        updates nightly at 03:00. Leave it empty to update only via the button on the
        <NuxtLink
          to="/system"
          class="text-toned underline underline-offset-2"
        >System</NuxtLink> page.
      </p>
      <div class="flex-none">
        <UInput
          v-model="autoUpdateCron"
          placeholder="0 3 * * *"
          :disabled="isPreset(settings, 'autoUpdateCron')"
          aria-label="Automatic update schedule"
          class="k-mono w-40"
        />
        <p
          v-if="isPreset(settings, 'autoUpdateCron')"
          class="k-mono mt-2 text-2xs text-dimmed"
        >
          Preset by the installation.
        </p>
      </div>
    </div>
  </KPanel>
</template>
