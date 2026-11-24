<script setup lang="ts">
import type { IntegrationId } from '#shared/utils/integrations'
import { useToastError } from '~/composables/useToastError'
import { useRoute, $fetch } from '#imports'
import { useProject } from '~/composables/useProjects'
import { ref, watch, computed } from 'vue'
import { useAutosave } from '~/composables/useAutosave'
import { useWorkflows } from '~/composables/useWorkflows'
import { useIntegrations } from '~/composables/useIntegrations'
import { integrationUi } from '~/utils/integrations'
import KSaveStatus from '~/components/KSaveStatus.vue'
import WorkflowCodeEditor from '~/components/workflow/CodeEditor.vue'
import KPanel from '~/components/KPanel.vue'
import KSettingsMcp from '~/components/KSettingsMcp.vue'
import KSettingsAi from '~/components/KSettingsAi.vue'
import KSettingRow from '~/components/KSettingRow.vue'
import { USwitch, NuxtLink, USelectMenu, UIcon, UTooltip } from '#components'

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
const { data: integrations } = await useIntegrations()
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
    <KSettingsAi :project-id="project.id" />
    <KSettingsMcp :project-id="project.id" />
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
        <p class="mb-2.5 text-xs leading-relaxed text-muted">
          Rules the agent follows in this project only, on top of the instructions from the global
          <NuxtLink
            to="/settings/agent"
            class="text-toned underline underline-offset-2"
          >Agent settings</NuxtLink>.
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
      <KSettingRow label="Start with a preview">
        <template #hint>
          Boots the app so Knecht can check its work. Off: code only, faster.
          <template v-if="mentionPreview && !hasBootCommands">
            Needs boot commands. Until then, mentions work on the code only.
            <NuxtLink
              :to="`/projects/${id}/settings`"
              class="text-toned underline underline-offset-2 hover:text-highlighted"
            >Add them in Environment</NuxtLink>.
          </template>
        </template>
        <div class="flex lg:justify-end">
          <USwitch
            :model-value="mentionPreview"
            aria-label="Start with a preview"
            @update:model-value="setMentionPreview"
          />
        </div>
      </KSettingRow>
      <KSettingRow
        label="Setup workflow"
        hint="Runs once before the first mention in a thread, for example to seed test data."
      >
        <USelectMenu
          :model-value="starterItems.find(i => i.value === starterWorkflowId)"
          :items="starterItems"
          placeholder="None"
          clear
          aria-label="Setup workflow"
          class="w-full"
          @update:model-value="(item: { value: number } | null | undefined) => setStarter(item?.value ?? null)"
        />
      </KSettingRow>
      <KSettingRow
        label="Works in"
        hint="Mention Knecht in a comment. It does what you ask and replies in the thread."
      >
        <div class="flex flex-wrap items-center gap-1.5 lg:justify-end">
          <UTooltip
            v-for="i in configuredIntegrations"
            :key="i.id"
            :text="mentionHint(i)"
          >
            <span
              tabindex="0"
              class="flex items-center gap-1.5 rounded-full border border-default px-2.5 py-1 text-xs text-muted outline-hidden"
            >
              <UIcon
                :name="integrationUi(i.id).icon"
                class="size-3"
                :style="{ color: integrationUi(i.id).color }"
              />
              {{ i.name }}
            </span>
          </UTooltip>
        </div>
      </KSettingRow>
    </KPanel>
  </div>
</template>
