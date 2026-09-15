<script setup lang="ts">
import type { IntegrationId } from '#shared/utils/integrations'

const props = defineProps<{
  projectId: number
  integration: { id: IntegrationId, name: string, link: { label: string } }
  modelValue: string | null
}>()

const toastError = useToastError()
const ui = integrationUi(props.integration.id)

const { data: targets } = useFetch<{ key: string, name: string }[]>(`/api/integrations/${props.integration.id}/link-targets`, { default: () => [], lazy: true })
const items = computed(() => [
  { label: 'Not linked', value: null as string | null },
  ...targets.value.map(t => ({ label: `${t.key} · ${t.name}`, value: t.key as string | null })),
])

const key = ref<string | null>(props.modelValue)
async function setLink(value: string | null) {
  const previous = key.value
  key.value = value
  try {
    await $fetch(`/api/projects/${props.projectId}/link`, { method: 'PUT', body: { integration: props.integration.id, key: value } })
  }
  catch (e) {
    key.value = previous
    toastError(`Failed to link the ${props.integration.link.label}`, e)
  }
}
</script>

<template>
  <KPanel
    :title="integration.name"
    :icon="ui.icon"
    :accent="ui.color"
  >
    <div class="flex flex-col">
      <p class="text-2xs leading-relaxed text-dimmed">
        Tickets of the linked {{ integration.link.label }} can start this repo's workflows, get Knecht's
        replies, and turn mentions into follow-ups. One {{ integration.link.label }} per repository.
      </p>
      <div class="k-label mb-1.5 mt-3">
        {{ integration.link.label }}
      </div>
      <USelectMenu
        :model-value="items.find(i => i.value === key)"
        :items="items"
        placeholder="Not linked"
        class="w-full"
        @update:model-value="(item: { value: string | null } | undefined) => setLink(item?.value ?? null)"
      />
    </div>
  </KPanel>
</template>
