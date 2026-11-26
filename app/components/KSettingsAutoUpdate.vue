<script setup lang="ts">
import { useSettings, patchSettings, isPreset } from '~/composables/useSettings'
import { ref, watch } from 'vue'
import { useAutosave } from '~/composables/useAutosave'
import KSaveStatus from '~/components/KSaveStatus.vue'
import KSettingRow from '~/components/KSettingRow.vue'
import KPanel from '~/components/KPanel.vue'
import { NuxtLink, UInput, USwitch } from '#components'

defineProps<{ editable: boolean }>()

const { data: settings } = useSettings()
const autoUpdateCron = ref('')
const prereleaseUpdates = ref(false)
watch(settings, (s) => {
  if (!s) return
  autoUpdateCron.value = s.autoUpdateCron
  prereleaseUpdates.value = s.prereleaseUpdates
}, { immediate: true })
const { state: saveState, error: saveError, schedule } = useAutosave(() =>
  patchSettings(settings, { autoUpdateCron: autoUpdateCron.value.trim(), prereleaseUpdates: prereleaseUpdates.value }))
watch([autoUpdateCron, prereleaseUpdates], () => {
  if (autoUpdateCron.value.trim() === (settings.value?.autoUpdateCron ?? '')
    && prereleaseUpdates.value === settings.value?.prereleaseUpdates) return
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
    <KSettingRow
      label="Release candidates"
      :preset="isPreset(settings, 'prereleaseUpdates')"
    >
      <template #hint>
        Offers release candidates on the
        <NuxtLink
          to="/system"
          class="text-toned underline underline-offset-2"
        >System</NuxtLink> page. They can be unstable. The schedule always installs stable releases only.
      </template>
      <div class="flex lg:justify-end">
        <USwitch
          v-model="prereleaseUpdates"
          :disabled="!editable || isPreset(settings, 'prereleaseUpdates')"
          aria-label="Offer release candidates"
        />
      </div>
    </KSettingRow>
  </KPanel>
</template>
