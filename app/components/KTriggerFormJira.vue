<script setup lang="ts">
const props = defineProps<{ linkKey: string | null }>()
const config = defineModel<Record<string, unknown>>('config', { required: true })
const valid = defineModel<boolean>('valid', { default: false })

type JiraEvent = 'created' | 'labeled' | 'transitioned' | 'assigned'

const { data: jiraConnection } = useFetch<{ configured: boolean }>('/api/jira/connection', { lazy: true })

const initial = config.value as { event?: JiraEvent, label?: string, status?: string, issueType?: string }
const event = ref<JiraEvent>(initial.event ?? 'labeled')
const label = ref(initial.label ?? 'knecht')
const status = ref(initial.status ?? '')
const issueType = ref(initial.issueType ?? '')
const statuses = ref<string[]>([])

watch([() => props.linkKey, event], async ([key, ev]) => {
  if (!key || ev !== 'transitioned') return
  try {
    statuses.value = await $fetch<string[]>('/api/jira/statuses', { query: { project: key } })
  }
  catch {
    statuses.value = []
  }
}, { immediate: true })

const looksValid = computed(() =>
  !!jiraConnection.value?.configured
  && (event.value === 'labeled' ? !!label.value.trim() : event.value === 'transitioned' ? !!status.value : true),
)

watch([event, label, status, issueType, looksValid], () => {
  config.value = {
    event: event.value,
    ...(event.value === 'labeled' ? { label: label.value.trim() } : {}),
    ...(event.value === 'transitioned' ? { status: status.value } : {}),
    ...(issueType.value.trim() ? { issueType: issueType.value.trim() } : {}),
  }
  valid.value = looksValid.value
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <p
      v-if="jiraConnection && !jiraConnection.configured"
      class="rounded-md border border-muted bg-(--surface-muted) px-3 py-2.5 text-2xs leading-normal text-muted"
    >
      Jira is not connected yet. Connect it in
      <NuxtLink
        to="/settings/jira"
        class="text-toned underline underline-offset-2"
      >Settings → Jira</NuxtLink>
      first, register the webhook it shows, then link a project to its Jira project in the project settings.
    </p>

    <template v-else>
      <div>
        <span class="k-label">Fires when</span>
        <USelectMenu
          v-model="event"
          value-key="value"
          :items="[
            { label: 'A ticket is created', value: 'created' },
            { label: 'A label is added', value: 'labeled' },
            { label: 'A status is reached', value: 'transitioned' },
            { label: 'The ticket is assigned to the Knecht account', value: 'assigned' },
          ]"
          class="mt-2 w-full"
        />
        <UInput
          v-if="event === 'labeled'"
          v-model="label"
          placeholder="Label name, e.g. knecht"
          class="mt-2 w-full"
          :ui="{ base: 'k-mono' }"
        />
        <USelectMenu
          v-else-if="event === 'transitioned'"
          v-model="status"
          :items="statuses"
          :disabled="!linkKey"
          :placeholder="linkKey ? 'Select a status…' : 'Pick a project first'"
          class="mt-2 w-full"
        />
        <p
          v-else-if="event === 'assigned'"
          class="mt-2 text-2xs text-dimmed"
        >
          Fires when a ticket is assigned to the account the Jira connection uses,
          so "give it to Knecht" is a normal assignment in Jira.
        </p>
      </div>

      <div>
        <span class="k-label">Issue type</span>
        <UInput
          v-model="issueType"
          placeholder="Any type, or e.g. Bug"
          class="mt-2 w-full"
        />
      </div>

      <p class="text-2xs text-dimmed">
        Jira sends ticket events to the webhook from Settings → Jira; a matching ticket starts
        the workflow with the ticket as inputs and keeps its session for replies and follow-ups.
      </p>
    </template>
  </div>
</template>
