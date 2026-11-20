<script setup lang="ts">
import { AI_PROVIDERS, type AiProviderId, type LangdockRegion, aiProviderSpec } from '#shared/utils/ai'
import { useToastError } from '~/composables/useToastError'
import { useUserSession, refreshNuxtData, $fetch } from '#imports'
import { useSettings, isPreset, patchSettings } from '~/composables/useSettings'
import { useMembers } from '~/composables/useMembers'
import { useProjectAi } from '~/composables/useProjects'
import { computed, ref, watch } from 'vue'
import { useAiModels, useProjectAiModels } from '~/composables/useAiModels'
import { useAutosave } from '~/composables/useAutosave'
import KSaveStatus from '~/components/KSaveStatus.vue'
import KSettingRow from '~/components/KSettingRow.vue'
import KSecretField from '~/components/KSecretField.vue'
import KPanel from '~/components/KPanel.vue'
import KConfirmModal from '~/components/KConfirmModal.vue'
import { USelect, UButton, UInput, USelectMenu } from '#components'

// With a project it edits that project's overrides, where null inherits Settings → Agent.
const props = defineProps<{ projectId?: number }>()

const toastError = useToastError()
const { user } = useUserSession()
const { data: settings, error: settingsError } = await useSettings()
const { data: members } = await useMembers()
const { data: projectAi, error: projectAiError } = props.projectId ? await useProjectAi(props.projectId) : { data: ref(null), error: ref(null) }
const loadError = computed(() => props.projectId ? projectAiError.value : settingsError.value)
const isOwner = computed(() => !!members.value?.find(m => m.id === user.value?.id)?.isOwner)
const providerLocked = (key: string) => !isOwner.value || (!props.projectId && isPreset(settings.value, key))

// Reka reserves '' as the clear value, so "None" and "Global default" need sentinels.
const NO_SUBTASK_MODEL = '__none__'
const INHERIT = '__inherit__'
type ProviderChoice = AiProviderId | typeof INHERIT

interface AiForm { provider: ProviderChoice, region: LangdockRegion, model: string, subtask: string }
const source = computed<AiForm | null>(() => {
  if (props.projectId) {
    if (!projectAi.value) return null
    const own = projectAi.value.overrides
    if (!own?.aiProvider) return { provider: INHERIT, region: 'eu', model: own?.aiModel ?? INHERIT, subtask: own?.aiSubtaskModel ?? INHERIT }
    return { provider: own.aiProvider as AiProviderId, region: (own.aiRegion ?? 'eu') as LangdockRegion, model: own.aiModel ?? '', subtask: own.aiSubtaskModel ?? NO_SUBTASK_MODEL }
  }
  const s = settings.value
  if (!s) return null
  return { provider: s.aiProvider as AiProviderId, region: s.aiRegion as LangdockRegion, model: s.aiModel ?? '', subtask: s.aiSubtaskModel ?? NO_SUBTASK_MODEL }
})

const aiProvider = ref<ProviderChoice>()
const aiRegion = ref<LangdockRegion>()
const aiModel = ref('')
const aiSubtaskModel = ref(NO_SUBTASK_MODEL)
watch(source, (s) => {
  if (!s) return
  aiProvider.value = s.provider
  aiRegion.value = s.region
  aiModel.value = s.model
  aiSubtaskModel.value = s.subtask
}, { immediate: true })
const inheritsProvider = computed(() => aiProvider.value === INHERIT)
const ownKeyPreview = computed(() => projectAi.value?.overrides?.aiKeyPreview)
const keyPreview = computed(() => {
  if (!props.projectId) return settings.value?.aiKeyPreview
  if (aiProvider.value !== source.value?.provider) return undefined
  return ownKeyPreview.value ?? (inheritsProvider.value ? settings.value?.aiKeyPreview : undefined)
})

const modelsKey = props.projectId ? `project-ai-models:${props.projectId}` : 'ai-models'
const { data: aiModels, status: aiModelsStatus, error: aiModelsError } = props.projectId ? useProjectAiModels(props.projectId) : useAiModels()
const catalogItems = computed(() =>
  aiModels.value.map(m => ({ label: m.id, description: `${m.name} · ${m.provider}`, id: m.id })))
const globalDefault = (value: string | null | undefined) => `Global default (${value ?? 'none'})`
const modelItems = computed(() => [
  ...(inheritsProvider.value ? [{ label: globalDefault(settings.value?.aiModel), id: INHERIT }] : []),
  ...catalogItems.value,
])
const subtaskItems = computed(() => [
  inheritsProvider.value
    ? { label: globalDefault(settings.value?.aiSubtaskModel), id: INHERIT }
    : { label: 'None', description: 'The main model handles everything', id: NO_SUBTASK_MODEL },
  ...catalogItems.value,
])
const PROVIDER_ITEMS = AI_PROVIDERS.map(p => ({ label: p.label, id: p.id as ProviderChoice }))
// In a project the global provider is only offered as the default: an own key works under it.
const providerItems = computed(() => props.projectId
  ? [
      { label: globalDefault(aiProviderSpec(settings.value?.aiProvider ?? '')?.label), id: INHERIT as ProviderChoice },
      ...PROVIDER_ITEMS.filter(p => p.id !== settings.value?.aiProvider || p.id === source.value?.provider),
    ]
  : PROVIDER_ITEMS)
const REGION_ITEMS = [
  { label: 'EU', id: 'eu' },
  { label: 'US', id: 'us' },
]

// A provider switch clears the models (the old names would not resolve) and, in a project, its key.
function applyProvider(next: ProviderChoice) {
  aiProvider.value = next
  aiModel.value = next === INHERIT ? INHERIT : ''
  aiSubtaskModel.value = next === INHERIT ? INHERIT : NO_SUBTASK_MODEL
}
const pendingProvider = ref<ProviderChoice>()
const confirmingProvider = computed({
  get: () => pendingProvider.value !== undefined,
  set: (open) => { if (!open) pendingProvider.value = undefined },
})
function selectProvider(next: ProviderChoice) {
  if (next === aiProvider.value) return
  const picked = (m: string) => !!m && m !== INHERIT && m !== NO_SUBTASK_MODEL
  if (picked(aiModel.value) || picked(aiSubtaskModel.value) || ownKeyPreview.value) pendingProvider.value = next
  else applyProvider(next)
}
function confirmProvider() {
  applyProvider(pendingProvider.value!)
  pendingProvider.value = undefined
}

const nullIf = (value: string, ...empty: string[]) => empty.includes(value.trim()) ? null : value.trim()
function projectProviderBody() {
  return {
    aiProvider: inheritsProvider.value ? null : aiProvider.value,
    aiRegion: inheritsProvider.value ? null : aiRegion.value,
  }
}
async function patchProject(body: Record<string, unknown>) {
  projectAi.value = await $fetch(`/api/projects/${props.projectId}/ai`, { method: 'PATCH', body })
}

const { state: saveState, error: saveError, schedule, invalid } = useAutosave(async () => {
  if (props.projectId) {
    await patchProject({
      ...projectProviderBody(),
      aiModel: nullIf(aiModel.value, '', INHERIT),
      aiSubtaskModel: nullIf(aiSubtaskModel.value, NO_SUBTASK_MODEL, INHERIT),
    })
  }
  else {
    await patchSettings(settings, {
      aiProvider: aiProvider.value,
      aiRegion: aiRegion.value,
      aiModel: nullIf(aiModel.value, ''),
      aiSubtaskModel: nullIf(aiSubtaskModel.value, NO_SUBTASK_MODEL),
    })
  }
  await refreshNuxtData(modelsKey)
})
watch([aiProvider, aiRegion, aiModel, aiSubtaskModel], () => {
  const s = source.value
  if (!s) return
  if (
    aiProvider.value === s.provider
    && aiRegion.value === s.region
    && aiModel.value === s.model
    && aiSubtaskModel.value === s.subtask
  ) return
  if (!aiModel.value.trim() && aiProvider.value === s.provider) {
    return invalid('Pick a default model')
  }
  // Saved alone, the switch would leave the project without a working key until one is added.
  if (props.projectId && !inheritsProvider.value && aiProvider.value !== s.provider) {
    return invalid('Save a key for this provider first')
  }
  schedule()
})

const aiKey = ref('')
const aiKeyChanged = computed(() => !!aiKey.value.trim())
const savingAiKey = ref(false)
async function saveAiKey(value: string | null) {
  savingAiKey.value = true
  try {
    // The pending provider goes along: saved after the key, its switch would drop the key again.
    if (props.projectId) await patchProject({ ...projectProviderBody(), aiKey: value })
    else await patchSettings(settings, { aiKey: value })
    aiKey.value = ''
    await refreshNuxtData(modelsKey)
  }
  catch (e) {
    toastError('Could not save the key', e)
  }
  finally {
    savingAiKey.value = false
  }
}

const status = computed(() => {
  if (!props.projectId) return settings.value?.aiKeyConfigured ? 'Ready' : 'Not configured'
  if (!projectAi.value?.effective.aiKeyConfigured) return 'Not configured'
  return ownKeyPreview.value ? 'Own key' : 'Global key'
})
</script>

<template>
  <KPanel
    :title="projectId ? 'AI connection' : 'Agent'"
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
        :class="status === 'Not configured' ? 'text-dimmed' : 'text-primary'"
      >
        {{ status }}
      </span>
    </template>
    <p
      v-if="loadError"
      class="text-xs text-error"
    >
      Could not load the AI connection. Reload the page to try again.
    </p>
    <template v-else>
      <KSettingRow
        label="Provider"
        :preset="!projectId && isPreset(settings, 'aiProvider')"
      >
        <template #hint>
          <template v-if="projectId">
            Another provider needs its own key and models.
          </template>
          <template v-else>
            The service the <span class="k-code">ai</span> workflow step runs opencode against.
          </template>
          <template v-if="aiProvider === 'langdock'">
            Langdock keeps all requests in the selected region.
          </template>
        </template>
        <div class="flex gap-2">
          <!-- Mounted with an undefined value, Reka's Select stays uncontrolled and would show a cancelled switch. -->
          <USelect
            :key="aiProvider ? 'loaded' : 'loading'"
            :model-value="aiProvider"
            :items="providerItems"
            value-key="id"
            :disabled="providerLocked('aiProvider')"
            class="flex-1"
            @update:model-value="selectProvider($event as ProviderChoice)"
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
        :hint="!projectId
          ? 'Stored encrypted. The model list loads once a key is saved.'
          : inheritsProvider
            ? 'The global key until you enter one. An own key bills this project\'s usage separately. Stored encrypted.'
            : 'Required for this provider. Stored encrypted. The model list loads once a key is saved.'"
        :preset="!projectId && isPreset(settings, 'aiKey')"
      >
        <form @submit.prevent="aiKeyChanged && saveAiKey(aiKey.trim())">
          <KSecretField
            v-model="aiKey"
            :preview="keyPreview"
            :placeholder="projectId ? 'Paste the project\'s key' : 'oc_sk_…'"
            :disabled="providerLocked('aiKey')"
          >
            <UButton
              v-if="aiKeyChanged && !providerLocked('aiKey')"
              type="submit"
              color="primary"
              label="Save"
              :loading="savingAiKey"
            />
            <UButton
              v-else-if="projectId && inheritsProvider && ownKeyPreview && isOwner"
              color="neutral"
              variant="ghost"
              label="Use global"
              :loading="savingAiKey"
              @click="saveAiKey(null)"
            />
          </KSecretField>
        </form>
      </KSettingRow>

      <KSettingRow
        label="Default model"
        :hint="!projectId
          ? 'Used by every ai step that doesn\'t pick its own. For OpenCode the list comes from your workspace.'
          : inheritsProvider
            ? 'Used by every ai step that doesn\'t pick its own.'
            : 'Used by every ai step that doesn\'t pick its own. A step whose model this provider lacks runs on Settings → Agent.'"
        :preset="!projectId && isPreset(settings, 'aiModel')"
      >
        <UInput
          v-if="aiModelsError"
          :model-value="aiModel === INHERIT ? '' : aiModel"
          :placeholder="inheritsProvider ? globalDefault(settings?.aiModel) : 'claude-opus-5-5'"
          :disabled="providerLocked('aiModel')"
          :color="saveError ? 'error' : undefined"
          :highlight="!!saveError"
          class="w-full"
          @update:model-value="aiModel = ($event as string).trim() || (inheritsProvider ? INHERIT : '')"
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
        :preset="!projectId && isPreset(settings, 'aiSubtaskModel')"
      >
        <UInput
          v-if="aiModelsError"
          :model-value="aiSubtaskModel === NO_SUBTASK_MODEL || aiSubtaskModel === INHERIT ? '' : aiSubtaskModel"
          :placeholder="inheritsProvider ? globalDefault(settings?.aiSubtaskModel) : 'None, the main model handles everything'"
          :disabled="providerLocked('aiSubtaskModel')"
          class="w-full"
          @update:model-value="aiSubtaskModel = ($event as string).trim() || (inheritsProvider ? INHERIT : NO_SUBTASK_MODEL)"
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
    </template>

    <KConfirmModal
      v-model:open="confirmingProvider"
      title="Switch the provider?"
      :description="projectId ? 'The project\'s key and model choices are cleared.' : 'Your model choices are cleared.'"
      detail="The default and subtask model don't exist at the new provider, so you pick new ones afterwards."
      confirm-label="Switch"
      @confirm="confirmProvider"
    />
  </KPanel>
</template>
