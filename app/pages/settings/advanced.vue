<script setup lang="ts">
import { SSH_TARGET_RE } from '#shared/utils/settings-limits'

// Advanced: rarely-touched settings. Currently just remote access, the
// operator's SSH address for the run page's terminal modal.
// Autosaves trimmed; an emptied field clears the setting (sshTarget: null).
// The address is validated against the server's charset before it is sent,
// because it gets spliced verbatim into the copy-pasteable ssh command.
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

// Autosave (useAutosave: debounce, save state, flush on unmount).
// patchSettings merges the echo in place, so the settings watcher above
// doesn't re-fire and reset the field mid-edit.
const { state: saveState, error: saveError, schedule, invalid } = useAutosave(() =>
  patchSettings(settings, { sshTarget: sshTarget.value.trim() || null }))
watch(sshTarget, () => {
  if (sshTarget.value === (settings.value?.sshTarget ?? '')) return
  if (!validate()) return invalid('Not saved, check the value')
  schedule()
})
</script>

<template>
  <KPanel
    title="Remote access"
    icon="i-lucide-terminal"
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
      :color="fieldError ? 'error' : undefined"
      :highlight="!!fieldError"
      class="k-mono w-full max-w-sm"
    />
    <p
      v-if="fieldError"
      class="mt-2 text-xs leading-normal text-error"
    >
      {{ fieldError }}
    </p>
  </KPanel>
</template>
