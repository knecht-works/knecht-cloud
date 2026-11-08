<script setup lang="ts">
import { AI_PROVIDERS, type AiProviderId, type LangdockRegion } from '#shared/utils/ai'

const toastError = useToastError()
const { user } = useUserSession()
const { data: settings } = await useSettings()
const { data: members } = await useMembers()
const isOwner = computed(() => !!members.value?.find(m => m.id === user.value?.id)?.isOwner)
const providerLocked = (key: string) => !isOwner.value || isPreset(settings.value, key)

// Reka reserves '' as the clear value, so "None" needs a sentinel.
const NO_SUBTASK_MODEL = '__none__'

const aiProvider = ref<AiProviderId>()
const aiRegion = ref<LangdockRegion>()
const aiModel = ref('')
const aiSubtaskModel = ref(NO_SUBTASK_MODEL)
const agentInstructions = ref('')
watch(settings, (s) => {
  if (!s) return
  aiProvider.value = s.aiProvider as AiProviderId
  aiRegion.value = s.aiRegion as LangdockRegion
  aiModel.value = s.aiModel ?? ''
  aiSubtaskModel.value = s.aiSubtaskModel ?? NO_SUBTASK_MODEL
  agentInstructions.value = s.agentInstructions
}, { immediate: true })

// A provider switch clears both model fields (the old names would not resolve);
// the guard keeps the initial settings load from clearing them.
watch(aiProvider, () => {
  if (!settings.value || aiProvider.value === settings.value.aiProvider) return
  aiModel.value = ''
  aiSubtaskModel.value = NO_SUBTASK_MODEL
})

const { data: aiModels, status: aiModelsStatus, error: aiModelsError } = useAiModels()
const modelItems = computed(() =>
  aiModels.value.map(m => ({ label: m.id, description: `${m.name} · ${m.provider}`, id: m.id })))
const subtaskItems = computed(() => [
  { label: 'None', description: 'The main model handles everything', id: NO_SUBTASK_MODEL },
  ...modelItems.value,
])

const pendingProvider = ref<AiProviderId>()
const confirmingProvider = computed({
  get: () => pendingProvider.value !== undefined,
  set: (open) => { if (!open) pendingProvider.value = undefined },
})
function selectProvider(next: AiProviderId) {
  if (next === aiProvider.value) return
  if (aiModel.value || aiSubtaskModel.value !== NO_SUBTASK_MODEL) pendingProvider.value = next
  else aiProvider.value = next
}
function confirmProvider() {
  aiProvider.value = pendingProvider.value
  pendingProvider.value = undefined
}

const PROVIDER_ITEMS = AI_PROVIDERS.map(p => ({ label: p.label, id: p.id }))
const REGION_ITEMS = [
  { label: 'EU', id: 'eu' },
  { label: 'US', id: 'us' },
]

const { state: saveState, error: saveError, schedule, invalid } = useAutosave(async () => {
  await patchSettings(settings, {
    aiProvider: aiProvider.value,
    aiRegion: aiRegion.value,
    aiModel: aiModel.value.trim() || null,
    aiSubtaskModel: aiSubtaskModel.value === NO_SUBTASK_MODEL ? null : aiSubtaskModel.value,
  })
  await refreshNuxtData('ai-models')
})
watch([aiProvider, aiRegion, aiModel, aiSubtaskModel], () => {
  if (
    aiProvider.value === settings.value?.aiProvider
    && aiRegion.value === settings.value?.aiRegion
    && aiModel.value === (settings.value?.aiModel ?? '')
    && aiSubtaskModel.value === (settings.value?.aiSubtaskModel ?? NO_SUBTASK_MODEL)
  ) return
  if (!aiModel.value.trim() && aiProvider.value === settings.value?.aiProvider) {
    return invalid('Pick a default model')
  }
  schedule()
})

const { state: instructionsState, error: instructionsError, schedule: scheduleInstructions } = useAutosave(async () => {
  await patchSettings(settings, { agentInstructions: agentInstructions.value })
})
watch(agentInstructions, () => {
  if (agentInstructions.value === settings.value?.agentInstructions) return
  scheduleInstructions()
})

const aiKey = ref('')
const aiKeyChanged = computed(() => !!aiKey.value.trim())

const savingAiKey = ref(false)
async function saveAiKey() {
  if (!aiKeyChanged.value) return
  savingAiKey.value = true
  try {
    await patchSettings(settings, { aiKey: aiKey.value.trim() })
    aiKey.value = ''
    await refreshNuxtData('ai-models')
  }
  catch (e) {
    toastError('Could not save the key', e)
  }
  finally {
    savingAiKey.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4.5">
    <KPanel
      title="Agent"
      icon="i-lucide-sparkles"
      accent="var(--accent-orange)"
    >
      <template #action>
        <KSaveStatus
          v-if="saveState !== 'idle'"
          :state="saveState"
          :error-text="saveError"
        />
        <span
          v-else
          class="k-mono text-2xs"
          :class="settings?.aiKeyConfigured ? 'text-primary' : 'text-dimmed'"
        >
          {{ settings?.aiKeyConfigured ? 'Ready' : 'Not configured' }}
        </span>
      </template>
      <KSettingRow
        label="Provider"
        :preset="isPreset(settings, 'aiProvider')"
      >
        <template #hint>
          The service the <span class="k-code">ai</span> workflow step runs opencode against.
          <template v-if="aiProvider === 'langdock'">
            Langdock keeps all requests in the selected region.
          </template>
        </template>
        <div class="flex gap-2">
          <USelect
            :model-value="aiProvider"
            :items="PROVIDER_ITEMS"
            value-key="id"
            :disabled="providerLocked('aiProvider')"
            class="flex-1"
            @update:model-value="selectProvider($event as AiProviderId)"
          />
          <USelect
            v-if="aiProvider === 'langdock'"
            v-model="aiRegion"
            :items="REGION_ITEMS"
            value-key="id"
            aria-label="Langdock region"
            :disabled="providerLocked('aiRegion')"
            class="w-20"
          />
        </div>
      </KSettingRow>

      <KSettingRow
        label="API key"
        hint="Stored encrypted. The model list loads once a key is saved."
        :preset="isPreset(settings, 'aiKey')"
      >
        <form @submit.prevent="saveAiKey">
          <KSecretField
            v-model="aiKey"
            :preview="settings?.aiKeyPreview"
            placeholder="oc_sk_…"
            :disabled="providerLocked('aiKey')"
          >
            <UButton
              v-if="aiKeyChanged && !providerLocked('aiKey')"
              type="submit"
              color="primary"
              label="Save"
              :loading="savingAiKey"
            />
          </KSecretField>
        </form>
      </KSettingRow>

      <KSettingRow
        label="Default model"
        hint="Used by every ai step that doesn't pick its own. For OpenCode the list comes from your workspace."
        :preset="isPreset(settings, 'aiModel')"
      >
        <UInput
          v-if="aiModelsError"
          v-model="aiModel"
          placeholder="claude-opus-5-5"
          :disabled="providerLocked('aiModel')"
          :color="saveError ? 'error' : undefined"
          :highlight="!!saveError"
          class="w-full"
        />
        <USelectMenu
          v-else
          v-model="aiModel"
          :items="modelItems"
          value-key="id"
          :filter-fields="['label', 'description']"
          :loading="aiModelsStatus === 'pending'"
          :disabled="providerLocked('aiModel')"
          placeholder="claude-opus-5-5"
          class="w-full"
        />
        <p
          v-if="saveError"
          class="mt-2 text-xs leading-normal text-error"
        >
          {{ saveError }}
        </p>
      </KSettingRow>

      <KSettingRow
        label="Subtask model"
        hint="A faster model for the agent's small internal tasks and exploration subagents. The main model still does the actual work."
        :preset="isPreset(settings, 'aiSubtaskModel')"
      >
        <UInput
          v-if="aiModelsError"
          :model-value="aiSubtaskModel === NO_SUBTASK_MODEL ? '' : aiSubtaskModel"
          placeholder="None, the main model handles everything"
          :disabled="providerLocked('aiSubtaskModel')"
          class="w-full"
          @update:model-value="aiSubtaskModel = ($event as string).trim() || NO_SUBTASK_MODEL"
        />
        <USelectMenu
          v-else
          v-model="aiSubtaskModel"
          :items="subtaskItems"
          value-key="id"
          :filter-fields="['label', 'description']"
          :loading="aiModelsStatus === 'pending'"
          :disabled="providerLocked('aiSubtaskModel')"
          placeholder="None"
          class="w-full"
        />
      </KSettingRow>
    </KPanel>

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

    <KConfirmModal
      v-model:open="confirmingProvider"
      title="Switch the provider?"
      description="The default and subtask model are cleared, because their names don't exist at the new provider. Pick new ones afterwards."
      confirm-label="Switch"
      @confirm="confirmProvider"
    />
  </div>
</template>
