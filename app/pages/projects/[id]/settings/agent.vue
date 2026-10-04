<script setup lang="ts">
import type { IntegrationId } from '#shared/utils/integrations'
import { AGENT_INSTRUCTIONS_MAX } from '#shared/utils/settings-limits'

const toastError = useToastError()
const id = Number(useRoute().params.id)

const { data: project } = await useFetch(`/api/projects/${id}`)

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

const { data: workflows } = await useFetch('/api/workflows')
const starterItems = computed(() =>
  (workflows.value ?? [])
    .filter(w => w.publishedAt)
    .map(w => ({ label: w.name, value: w.id })),
)
const starterWorkflowId = ref<number | null>(project.value?.starterWorkflowId ?? null)
async function setStarter(value: number | null) {
  starterWorkflowId.value = value
  try {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body: { starterWorkflowId: value } })
  }
  catch (e) {
    toastError('Failed to save', e)
  }
}
const { data: integrations } = useFetch('/api/integrations', { default: () => [], lazy: true })
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
    class="flex flex-col gap-4.5"
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
        <UTextarea
          v-model="agentInstructions"
          :rows="4"
          autoresize
          :maxrows="16"
          :maxlength="AGENT_INSTRUCTIONS_MAX"
          placeholder="Styles live in src/css. Use the existing design tokens, never raw hex values."
          class="w-full"
        />
      </div>
    </KPanel>
    <KPanel
      title="Mentions"
      icon="i-lucide-at-sign"
      accent="var(--accent-orange)"
    >
      <div class="flex flex-col">
        <p class="text-xs leading-relaxed text-dimmed">
          Mention Knecht in a comment and it does what the comment says, then answers in the thread.
          The first mention in a thread boots the environment with the starter workflow.
        </p>
        <div class="k-label mb-1.5 mt-4">
          Starter workflow
        </div>
        <USelectMenu
          :model-value="starterItems.find(i => i.value === starterWorkflowId)"
          :items="starterItems"
          placeholder="Choose a workflow…"
          class="w-full"
          @update:model-value="(item: { value: number } | undefined) => setStarter(item?.value ?? null)"
        />
        <p
          v-if="!starterWorkflowId"
          class="mt-1.5 text-xs leading-relaxed text-dimmed"
        >
          Until one is chosen, Knecht answers mentions with a setup hint.
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-1.5">
          <span class="mr-1 text-xs text-dimmed">Works in</span>
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
