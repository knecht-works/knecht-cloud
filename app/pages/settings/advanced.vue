<script setup lang="ts">
import { SSH_TARGET_RE } from '#shared/utils/settings-limits'

// The address is validated against the server's charset because it is spliced
// verbatim into the copy-pasteable ssh command.
const { data: settings } = useSettings()

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
  patchSettings(settings, { sshTarget: sshTarget.value.trim() || null }))
watch(sshTarget, () => {
  if (sshTarget.value === (settings.value?.sshTarget ?? '')) return
  if (!validate()) return invalid('Not saved, check the value')
  schedule()
})
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <KSettingsEnvironments />
    <KSettingsAutoUpdate />
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
      <p class="mb-5 text-2sm leading-relaxed text-muted">
        How do you reach this server over SSH? The run page's terminal modal uses this
        address to build the copy-pasteable SSH command. The web terminal and the IDE
        work without it.
        <template v-if="settings?.sshTargetDefault">
          Leave it empty to use <span class="k-mono text-xs text-toned">{{ settings.sshTargetDefault }}</span>.
        </template>
      </p>
      <UInput
        v-model="sshTarget"
        :placeholder="settings?.sshTargetDefault ?? 'knecht@my-server.com'"
        :disabled="isPreset(settings, 'sshTarget')"
        :color="fieldError ? 'error' : undefined"
        :highlight="!!fieldError"
        class="k-mono w-full max-w-sm"
      />
      <p
        v-if="isPreset(settings, 'sshTarget')"
        class="k-mono mt-2 text-2xs text-dimmed"
      >
        Preset by the installation.
      </p>
      <p
        v-if="fieldError"
        class="mt-2 text-xs leading-normal text-error"
      >
        {{ fieldError }}
      </p>
    </KPanel>
  </div>
</template>
