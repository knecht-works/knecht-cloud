<script setup lang="ts">
import { AI_PROVIDERS, type AiProviderId, type LangdockRegion } from '#shared/utils/ai'
import { AGENT_INSTRUCTIONS_MAX } from '#shared/utils/settings-limits'

// Agent: the opencode provider, its (write-only) API key and the default model.
const toastError = useToastError()
const { data: settings } = useSettings()

// Reka reserves '' as the clear value, so the subtask picker's "None" entry
// needs a sentinel (same trick as the builder's ModelSelect).
const NO_SUBTASK_MODEL = '__none__'

const aiProvider = ref<AiProviderId>('anthropic')
const aiRegion = ref<LangdockRegion>('eu')
const aiModel = ref('claude-sonnet-4-5')
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

// A provider switch clears both model fields (the server does the same to the
// stored row): the old provider's names would not resolve, and a stale model
// used to block saving the new provider's key. The guard keeps the initial
// settings load (which sets provider and models together) from clearing them.
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

const PROVIDER_ITEMS = AI_PROVIDERS.map(p => ({ label: p.label, id: p.id }))
// Langdock serves per-region deployments; the region scopes every request and
// the model catalog, so it sits next to the provider and only shows for it.
const REGION_ITEMS = [
  { label: 'EU', id: 'eu' },
  { label: 'US', id: 'us' },
]

// Provider, region and default model autosave (useAutosave: debounce, save
// state, flush on unmount). A provider, region or key change refetches the
// (provider-scoped) model catalog.
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
  // An empty model only saves as part of a provider switch (where it means
  // "cleared"); emptying the field on its own asks for a pick instead.
  if (!aiModel.value.trim() && aiProvider.value === settings.value?.aiProvider) {
    return invalid('Pick a default model')
  }
  schedule()
})

// Instance instructions: own autosave so a typo-fix in the textarea never
// races the provider/model save above.
const { state: instructionsState, error: instructionsError, schedule: scheduleInstructions } = useAutosave(async () => {
  await patchSettings(settings, { agentInstructions: agentInstructions.value })
})
watch(agentInstructions, () => {
  if (agentInstructions.value === settings.value?.agentInstructions) return
  scheduleInstructions()
})

const aiKey = ref('')
const savingAiKey = ref(false)
async function saveAiKey() {
  if (!aiKey.value.trim()) return
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

// Remove the stored key (aiKey: null): ai steps then refuse to run until a
// new key is saved, so the button only shows while one is configured.
const removingAiKey = ref(false)
async function removeAiKey() {
  removingAiKey.value = true
  try {
    await patchSettings(settings, { aiKey: null })
    aiKey.value = ''
    await refreshNuxtData('ai-models')
  }
  catch (e) {
    toastError('Could not remove the key', e)
  }
  finally {
    removingAiKey.value = false
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
      <div class="flex gap-10">
        <div class="min-w-0 max-w-4xl flex-1">
          <p class="mb-5 text-2sm leading-relaxed text-muted">
            The <span class="k-mono text-xs text-toned">ai</span> workflow step
            runs opencode inside the run's sandbox, authenticated against the selected
            provider with this key. The key is stored encrypted, and each step can override
            the default model.
          </p>
          <div class="grid grid-cols-1 gap-5 sm:grid-cols-[13rem_1fr]">
            <div>
              <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Provider</span>
              <div class="mt-2 flex gap-2">
                <USelect
                  v-model="aiProvider"
                  :items="PROVIDER_ITEMS"
                  value-key="id"
                  class="flex-1"
                />
                <USelect
                  v-if="aiProvider === 'langdock'"
                  v-model="aiRegion"
                  :items="REGION_ITEMS"
                  value-key="id"
                  aria-label="Langdock region"
                  class="w-20"
                />
              </div>
              <p
                v-if="aiProvider === 'langdock'"
                class="mt-2 text-xs leading-normal text-muted"
              >
                Langdock keeps all requests in the selected region. The model list
                loads once an API key is saved.
              </p>
            </div>
            <div>
              <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">API key</span>
              <form
                class="mt-2 flex items-center gap-2"
                @submit.prevent="saveAiKey"
              >
                <UInput
                  v-model="aiKey"
                  type="password"
                  :placeholder="settings?.aiKeyPreview ?? (settings?.aiKeyConfigured ? 'Configured, enter a key to replace it' : 'sk-…')"
                  class="flex-1"
                />
                <UButton
                  type="submit"
                  color="primary"
                  size="xs"
                  label="Save"
                  :loading="savingAiKey"
                  :disabled="!aiKey.trim()"
                />
                <UButton
                  v-if="settings?.aiKeyConfigured"
                  type="button"
                  color="error"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-trash-2"
                  aria-label="Remove the stored API key"
                  :loading="removingAiKey"
                  @click="removeAiKey"
                />
              </form>
            </div>
            <div class="sm:col-span-2">
              <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Default model</span>
              <div class="mt-2">
                <UInput
                  v-if="aiModelsError"
                  v-model="aiModel"
                  placeholder="claude-sonnet-4-5"
                  :color="saveError ? 'error' : undefined"
                  :highlight="!!saveError"
                  class="w-full sm:max-w-md"
                />
                <USelectMenu
                  v-else
                  v-model="aiModel"
                  :items="modelItems"
                  value-key="id"
                  :filter-fields="['label', 'description']"
                  :loading="aiModelsStatus === 'pending'"
                  placeholder="claude-sonnet-4-5"
                  class="w-full sm:max-w-md"
                />
              </div>
              <p
                v-if="saveError"
                class="mt-2 text-xs leading-normal text-error"
              >
                {{ saveError }}
              </p>
              <p class="mt-2 text-xs leading-normal text-muted">
                Only the selected provider's models are offered. For OpenCode the list comes
                from your workspace, so models disabled there don't show up.
              </p>
            </div>
            <div class="sm:col-span-2">
              <span class="k-mono text-3xs uppercase tracking-widest text-dimmed">Subtask model</span>
              <div class="mt-2">
                <UInput
                  v-if="aiModelsError"
                  :model-value="aiSubtaskModel === NO_SUBTASK_MODEL ? '' : aiSubtaskModel"
                  placeholder="None, the main model handles everything"
                  class="w-full sm:max-w-md"
                  @update:model-value="aiSubtaskModel = ($event as string).trim() || NO_SUBTASK_MODEL"
                />
                <USelectMenu
                  v-else
                  v-model="aiSubtaskModel"
                  :items="subtaskItems"
                  value-key="id"
                  :filter-fields="['label', 'description']"
                  :loading="aiModelsStatus === 'pending'"
                  placeholder="None"
                  class="w-full sm:max-w-md"
                />
              </div>
              <p class="mt-2 text-xs leading-normal text-muted">
                A faster model the agent uses for its internal small tasks and
                exploration subagents. Runs get quicker and cheaper; the main
                model still does the actual work.
              </p>
            </div>
          </div>
        </div>
        <img
          src="/mascot/looking-right-knecht.svg"
          alt=""
          class="pointer-events-none ml-auto hidden h-52 w-auto shrink-0 self-center -scale-x-100 xl:mr-6 xl:block"
        >
      </div>
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
      <div class="max-w-4xl">
        <p class="mb-5 text-2sm leading-relaxed text-muted">
          What should the agent know or follow in every project? These rules are
          added on top of Knecht's built-in behavior rules; each project can add
          its own rules in its settings.
        </p>
        <UTextarea
          v-model="agentInstructions"
          :rows="4"
          autoresize
          :maxrows="16"
          :maxlength="AGENT_INSTRUCTIONS_MAX"
          placeholder="Always answer in German. Never touch anything under legacy/."
          class="w-full"
        />
        <p class="mt-2 text-xs leading-normal text-muted">
          Saved automatically and given to the agent on every run.
        </p>
      </div>
    </KPanel>
  </div>
</template>
