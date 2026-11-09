<script setup lang="ts">
import type { IntegrationId } from '#shared/utils/integrations'

const toastError = useToastError()
const id = Number(useRoute().params.id)

const { data: project } = await useProject(id)

const agentInstructions = ref(project.value?.agentInstructions ?? '')
const { state: instructionsState, error: instructionsError, schedule: scheduleInstructions } = useAutosave(async () => {
  await $fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    body: { agentInstructions: agentInstructions.value },
  })
})
watch(agentInstructions, () => {
  if (agentInstructions.value === (project.value?.agentInstructions ?? '')) return
  scheduleInstructions()
})

const mentionPreview = ref(project.value?.mentionPreview ?? true)
async function setMentionPreview(value: boolean) {
  mentionPreview.value = value
  try {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body: { mentionPreview: value } })
  }
  catch (e) {
    mentionPreview.value = !value
    toastError('Failed to save', e)
  }
}
const hasBootCommands = computed(() => !!project.value?.bootCommands.trim())

const { data: workflows } = await useWorkflows()
const starterItems = computed(() =>
  (workflows.value ?? [])
    .filter(w => w.publishedAt)
    .map(w => ({ label: w.name, value: w.id })),
)
const starterWorkflowId = ref<number | null>(project.value?.starterWorkflowId ?? null)
async function setStarter(value: number | null) {
  const previous = starterWorkflowId.value
  starterWorkflowId.value = value
  try {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body: { starterWorkflowId: value } })
  }
  catch (e) {
    starterWorkflowId.value = previous
    toastError('Failed to save', e)
  }
}
const { data: integrations } = useIntegrations()
const configuredIntegrations = computed(() => integrations.value.filter(i => i.configured))
function mentionHint(i: { id: IntegrationId, accountName: string | null }) {
  const { as, on } = integrationUi(i.id).mention
  const name = as ?? i.accountName
  return `Mention ${name ? `@${name}` : 'the Knecht account'} on ${on}.`
}
</script>

<template>
  <div
    v-if="project"
    class="grid grid-cols-1 items-start gap-4.5 lg:grid-cols-[minmax(0,1fr)_clamp(340px,26vw,560px)]"
  >
    <KPanel
      title="Agent instructions"
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
      <div>
        <p class="mb-2.5 text-xs leading-relaxed text-dimmed">
          Rules the agent follows in this project only, on top of the
          instance-wide instructions from Settings → Agent.
        </p>
        <div class="k-code-box">
          <WorkflowCodeEditor
            v-model="agentInstructions"
            lang="markdown"
            :rows="12"
            placeholder="Styles live in src/css. Use the existing design tokens, never raw hex values."
          />
        </div>
      </div>
    </KPanel>
    <KPanel
      title="Mentions"
      icon="i-lucide-at-sign"
      accent="var(--accent-orange)"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="text-sm text-highlighted">
            Start with a preview
          </div>
          <p class="mt-0.5 text-xs leading-relaxed text-muted">
            Boots the app so Knecht can check its work. Off: code only, faster.
          </p>
        </div>
        <USwitch
          :model-value="mentionPreview"
          aria-label="Start with a preview"
          class="mt-0.5"
          @update:model-value="setMentionPreview"
        />
      </div>
      <p
        v-if="mentionPreview && !hasBootCommands"
        class="mt-2.5 text-xs leading-relaxed text-dimmed"
      >
        Needs boot commands. Until then, mentions work on the code only.
        <NuxtLink
          :to="`/projects/${id}/settings`"
          class="text-toned underline underline-offset-2 hover:text-highlighted"
        >Add them in Environment</NuxtLink>.
      </p>
      <div class="mt-5">
        <div class="text-sm text-highlighted">
          Setup workflow
        </div>
        <p class="mt-0.5 mb-2.5 text-xs leading-relaxed text-muted">
          Runs once before the first mention in a thread, for example to seed test data.
        </p>
        <USelectMenu
          :model-value="starterItems.find(i => i.value === starterWorkflowId)"
          :items="starterItems"
          placeholder="None"
          clear
          aria-label="Setup workflow"
          class="w-full"
          @update:model-value="(item: { value: number } | null | undefined) => setStarter(item?.value ?? null)"
        />
      </div>
      <div class="mt-5">
        <div class="text-sm text-highlighted">
          Works in
        </div>
        <p class="mt-0.5 mb-2.5 text-xs leading-relaxed text-muted">
          Mention Knecht in a comment. It does what you ask and replies in the thread.
        </p>
        <div class="flex flex-wrap items-center gap-1.5">
          <UTooltip
            v-for="i in configuredIntegrations"
            :key="i.id"
            :text="mentionHint(i)"
          >
            <span class="k-mono flex items-center gap-1.5 rounded-full border border-default px-2.5 py-1 text-2xs text-muted">
              <UIcon
                :name="integrationUi(i.id).icon"
                class="size-3"
                :style="{ color: integrationUi(i.id).color }"
              />
              {{ i.name }}
            </span>
          </UTooltip>
        </div>
      </div>
    </KPanel>
  </div>
</template>
