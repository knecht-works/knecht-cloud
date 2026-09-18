<script setup lang="ts">
const props = defineProps<{ linkKeys: string[] }>()
const config = defineModel<Record<string, unknown>>('config', { required: true })
const valid = defineModel<boolean>('valid', { default: false })

type JiraEvent = 'created' | 'labeled' | 'transitioned' | 'assigned'
type StatusCategory = 'new' | 'indeterminate' | 'done'
interface StatusItem {
  type?: 'label' | 'separator'
  label?: string
  value?: string
  projects?: string
  class?: string
}

const CATEGORIES: { label: string, value: StatusCategory }[] = [
  { label: 'To Do', value: 'new' },
  { label: 'In Progress', value: 'indeterminate' },
  { label: 'Done', value: 'done' },
]

const { data: jiraConnection } = useFetch<{ configured: boolean }>('/api/jira/connection', { lazy: true })

const initial = config.value as { event?: JiraEvent, label?: string, status?: string, statusCategory?: StatusCategory, issueType?: string }
const event = ref<JiraEvent>(initial.event ?? 'labeled')
const label = ref(initial.label ?? 'knecht')
const byCategory = ref(!initial.status)
const statusCategory = ref<StatusCategory>(initial.statusCategory ?? 'done')
const status = ref(initial.status ?? '')
const issueType = ref(initial.issueType ?? '')
// null: the list could not be loaded, so nothing is known about that project.
const statusesByProject = ref<Record<string, string[] | null>>({})

watch([() => props.linkKeys, event], async ([keys, ev]) => {
  if (ev !== 'transitioned') return
  const entries = await Promise.all(keys.map(async key =>
    [key, await $fetch<string[]>('/api/jira/statuses', { query: { project: key } }).catch(() => null)] as const,
  ))
  if (keys !== props.linkKeys) return
  statusesByProject.value = Object.fromEntries(entries)
}, { immediate: true })

const projectsWith = (name: string) => props.linkKeys.filter(key => statusesByProject.value[key]?.includes(name))

const statusItems = computed<StatusItem[]>(() => {
  const names = [...new Set(Object.values(statusesByProject.value).flatMap(list => list ?? []))]
  const shared = names.filter(n => projectsWith(n).length === props.linkKeys.length)
  const partial = names.filter(n => projectsWith(n).length < props.linkKeys.length)
  if (props.linkKeys.length < 2 || !partial.length) return names.map(n => ({ label: n, value: n }))
  const heading = 'k-mono text-3xs font-normal uppercase tracking-(--tracking-label) text-dimmed'
  return [
    { type: 'label', label: `In all ${props.linkKeys.length} projects`, class: heading },
    ...shared.map(n => ({ label: n, value: n })),
    { type: 'separator' },
    { type: 'label', label: 'Only in some', class: heading },
    ...partial.map(n => ({ label: n, value: n, projects: projectsWith(n).join(', '), class: 'text-muted' })),
  ]
})

const missingIn = computed(() => {
  if (byCategory.value || !status.value) return []
  return props.linkKeys.filter(key => statusesByProject.value[key] && !statusesByProject.value[key]!.includes(status.value))
})

const looksValid = computed(() =>
  !!jiraConnection.value?.configured
  && (event.value === 'labeled' ? !!label.value.trim() : event.value === 'transitioned' ? (byCategory.value || !!status.value) : true),
)

watch([event, label, byCategory, statusCategory, status, issueType, looksValid], () => {
  config.value = {
    event: event.value,
    ...(event.value === 'labeled' ? { label: label.value.trim() } : {}),
    ...(event.value === 'transitioned' ? (byCategory.value ? { statusCategory: statusCategory.value } : { status: status.value }) : {}),
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
        to="/settings/integrations"
        class="text-toned underline underline-offset-2"
      >Settings → Integrations</NuxtLink>
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
        <template v-else-if="event === 'transitioned'">
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button
              v-for="mode in [
                { category: true, label: 'Status category', hint: 'Same in every project' },
                { category: false, label: 'Status name', hint: 'Exact name, per workflow' },
              ]"
              :key="mode.label"
              type="button"
              class="flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors"
              :class="byCategory === mode.category
                ? 'border-(--primary-border) bg-(--lime-950)'
                : 'border-muted bg-(--surface-muted) hover:border-default'"
              @click="byCategory = mode.category"
            >
              <span
                class="text-2sm font-medium"
                :class="byCategory === mode.category ? 'text-highlighted' : 'text-muted'"
              >{{ mode.label }}</span>
              <span class="text-2xs text-dimmed">{{ mode.hint }}</span>
            </button>
          </div>
          <template v-if="byCategory">
            <USelectMenu
              v-model="statusCategory"
              value-key="value"
              :items="CATEGORIES"
              class="mt-2 w-full"
            />
            <p class="mt-2 text-2xs text-dimmed">
              Fires when a ticket enters this category, whatever the status is called in each project's workflow.
            </p>
          </template>
          <template v-else>
            <USelectMenu
              v-model="status"
              value-key="value"
              :items="statusItems"
              :disabled="!linkKeys.length"
              :placeholder="linkKeys.length ? 'Select a status…' : 'Pick a project first'"
              class="mt-2 w-full"
            >
              <template #item-trailing="{ item }">
                <span
                  v-if="item.projects"
                  class="k-mono text-2xs text-dimmed"
                >{{ item.projects }}</span>
              </template>
            </USelectMenu>
            <p
              v-if="missingIn.length"
              class="mt-2 flex gap-2.5 rounded-md border border-(--status-orange)/35 bg-(--status-orange)/8 px-3 py-2.5 text-2xs leading-normal text-muted"
            >
              <UIcon
                name="i-lucide-triangle-alert"
                class="mt-px size-4 shrink-0 text-(--status-orange)"
              />
              <span>
                <span class="font-medium text-default">"{{ status }}" does not exist in {{ missingIn.join(', ') }}.</span>
                Tickets there will never fire this trigger. Pick a status all projects share, switch to a status category, or create a separate trigger for them.
              </span>
            </p>
          </template>
        </template>
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
    </template>
  </div>
</template>
