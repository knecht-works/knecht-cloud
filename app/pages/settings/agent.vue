<script setup lang="ts">
import { useSettings, isPreset, patchSettings } from '~/composables/useSettings'
import { ref, watch } from 'vue'
import { useAutosave } from '~/composables/useAutosave'
import KSaveStatus from '~/components/KSaveStatus.vue'
import KPanel from '~/components/KPanel.vue'
import KSettingsAi from '~/components/KSettingsAi.vue'
import KSettingsMcp from '~/components/KSettingsMcp.vue'
import WorkflowCodeEditor from '~/components/workflow/CodeEditor.vue'

const { data: settings } = await useSettings()

const agentInstructions = ref('')
watch(settings, (s) => {
  if (!s) return
  agentInstructions.value = s.agentInstructions
}, { immediate: true })

const { state: instructionsState, error: instructionsError, schedule: scheduleInstructions } = useAutosave(async () => {
  await patchSettings(settings, { agentInstructions: agentInstructions.value })
})
watch(agentInstructions, () => {
  if (agentInstructions.value === settings.value?.agentInstructions) return
  scheduleInstructions()
})
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <KSettingsAi />

    <KSettingsMcp />

    <KPanel
      title="Instructions"
      icon="i-lucide-list-checks"
      accent="var(--accent-orange)"
    >
      <template #action>
        <KSaveStatus
          v-if="instructionsState !== 'idle'"
          :state="instructionsState"
          :error-text="instructionsError"
        />
      </template>
      <p class="mb-2 max-w-3xl text-xs leading-relaxed text-muted">
        Markdown rules the agent follows in every project, on top of Knecht's built-in behavior
        rules. Each project can add its own in its settings.
      </p>
      <div class="k-code-box">
        <WorkflowCodeEditor
          v-model="agentInstructions"
          lang="markdown"
          :rows="6"
          :disabled="isPreset(settings, 'agentInstructions')"
          placeholder="Always answer in German. Never touch anything under legacy/."
        />
      </div>
      <p
        v-if="isPreset(settings, 'agentInstructions')"
        class="k-mono mt-2 text-2xs text-dimmed"
      >
        Preset by the installation.
      </p>
    </KPanel>
  </div>
</template>
