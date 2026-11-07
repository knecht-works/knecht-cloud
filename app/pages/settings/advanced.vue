<script setup lang="ts">
import { SSH_TARGET_RE } from '#shared/utils/settings-limits'

// The address is validated against the server's charset because it is spliced
// verbatim into the copy-pasteable ssh command.
const { data: settings } = useSettings()
const { withElevation } = useElevation()
const { user } = useUserSession()
const { data: members } = await useMembers()
const isOwner = computed(() => !!members.value?.find(m => m.id === user.value?.id)?.isOwner)

const sshTarget = ref('')
watch(settings, (s) => {
  if (!s) return
  sshTarget.value = s.sshTarget ?? ''
}, { immediate: true })

const fieldError = ref('')
function validate(): boolean {
  const v = sshTarget.value.trim()
  if (v && !SSH_TARGET_RE.test(v)) {
    fieldError.value = 'Only letters, digits and . _ @ - are allowed, without spaces (e.g. knecht@my-server.com).'
    return false
  }
  if (v.length > 200) {
    fieldError.value = 'Must be at most 200 characters.'
    return false
  }
  fieldError.value = ''
  return true
}

const { state: saveState, error: saveError, schedule, invalid } = useAutosave(() =>
  withElevation(() => patchSettings(settings, { sshTarget: sshTarget.value.trim() || null })))
watch(sshTarget, () => {
  if (sshTarget.value === (settings.value?.sshTarget ?? '')) return
  if (!validate()) return invalid('Not saved, check the value')
  schedule()
})
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <KSettingsEnvironments :editable="isOwner" />
    <KSettingsAutoUpdate :editable="isOwner" />
    <KPanel
      title="Remote access"
      icon="i-lucide-terminal"
      accent="var(--primary)"
    >
      <template #action>
        <KSaveStatus
          :state="saveState"
          :error-text="saveError"
        />
      </template>
      <KSettingRow
        label="SSH address"
        :preset="isPreset(settings, 'sshTarget')"
      >
        <template #hint>
          Used for the copy-pasteable SSH command in the run's terminal modal. The web terminal
          and the IDE work without it.
          <template v-if="settings?.sshTargetDefault">
            Empty uses <span class="k-code">{{ settings.sshTargetDefault }}</span>.
          </template>
        </template>
        <UInput
          v-model="sshTarget"
          :placeholder="settings?.sshTargetDefault ?? 'knecht@my-server.com'"
          :disabled="!isOwner || isPreset(settings, 'sshTarget')"
          :color="fieldError ? 'error' : undefined"
          :highlight="!!fieldError"
          class="w-full"
        />
        <p
          v-if="fieldError"
          class="mt-2 text-xs leading-normal text-error"
        >
          {{ fieldError }}
        </p>
      </KSettingRow>
    </KPanel>
  </div>
</template>
