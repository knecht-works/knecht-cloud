<script setup lang="ts">
import { AI_PROVIDERS, type AiProviderId } from '#shared/utils/ai'

// Agent: the opencode provider, its (write-only) API key and the default model.
const toastError = useToastError()
const { data: settings } = useSettings()

const aiProvider = ref<AiProviderId>('anthropic')
const aiModel = ref('claude-sonnet-4-5')
watch(settings, (s) => {
  if (!s) return
  aiProvider.value = s.aiProvider as AiProviderId
  aiModel.value = s.aiModel
}, { immediate: true })

const { data: aiModels, status: aiModelsStatus, error: aiModelsError } = useAiModels()
const modelItems = computed(() =>
  aiModels.value.map(m => ({ label: m.id, description: `${m.name} · ${m.provider}`, id: m.id })))

const PROVIDER_ITEMS = AI_PROVIDERS.map(p => ({ label: p.label, id: p.id }))

// Provider and default model autosave (useAutosave: debounce, save state,
// flush on unmount). A provider or key change refetches the (provider-scoped)
// model catalog.
const { state: saveState, error: saveError, schedule, invalid } = useAutosave(async () => {
  await patchSettings(settings, { aiProvider: aiProvider.value, aiModel: aiModel.value })
  await refreshNuxtData('ai-models')
})
watch([aiProvider, aiModel], () => {
  if (aiProvider.value === settings.value?.aiProvider && aiModel.value === settings.value?.aiModel) return
  if (!aiModel.value.trim()) return invalid('Pick a default model')
  schedule()
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
            <USelect
              v-model="aiProvider"
              :items="PROVIDER_ITEMS"
              value-key="id"
              class="mt-2 w-full"
            />
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
        </div>
      </div>
      <img
        src="/mascot/looking-right-knecht.svg"
        alt=""
        class="pointer-events-none ml-auto hidden h-52 w-auto shrink-0 self-center -scale-x-100 xl:mr-6 xl:block"
      >
    </div>
  </KPanel>
</template>
