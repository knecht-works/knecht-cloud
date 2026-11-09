<script setup lang="ts">
import type { IntegrationId } from '#shared/utils/integrations'

const props = defineProps<{
  projectId: number
  integration: { id: IntegrationId, name: string, link: { label: string } }
  modelValue: string | null
  name: string | null
}>()

const toastError = useToastError()
const ui = integrationUi(props.integration.id)

const { data: targets } = useFetch<{ key: string, name: string }[]>(`/api/integrations/${props.integration.id}/link-targets`, { default: () => [], lazy: true })
const key = ref<string | null>(props.modelValue)
const label = (k: string, n: string | null) => (n ? `${k} · ${n}` : k)
// Until the targets arrive from the tracker, the stored link stands in for them.
const items = computed(() => [
  { label: 'Not linked', value: null as string | null },
  ...(key.value && !targets.value.some(t => t.key === key.value) ? [{ label: label(key.value, props.name), value: key.value as string | null }] : []),
  ...targets.value.map(t => ({ label: label(t.key, t.name), value: t.key as string | null })),
])

async function setLink(value: string | null) {
  const previous = key.value
  key.value = value
  try {
    await $fetch(`/api/projects/${props.projectId}/link`, { method: 'PUT', body: {
      integration: props.integration.id,
      key: value,
      name: targets.value.find(t => t.key === value)?.name ?? null,
    } })
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
    <KSettingRow
      :label="integration.link.label"
      :hint="`Tickets of the linked ${integration.link.label} can start this repo's workflows, get Knecht's replies, and turn mentions into follow-ups. One ${integration.link.label} per repository.`"
    >
      <USelectMenu
        :model-value="items.find(i => i.value === key)"
        :items="items"
        placeholder="Not linked"
        class="w-full"
        @update:model-value="(item: { value: string | null } | undefined) => setLink(item?.value ?? null)"
      />
    </KSettingRow>
  </KPanel>
</template>
