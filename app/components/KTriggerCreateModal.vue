<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  presetWorkflowId?: number
  presetProjectIds?: number[]
  trigger?: {
    id: number
    source: 'schedule' | 'github' | 'manual' | 'jira'
    workflowId: number
    projectIds: number[]
    endpoint: string | null
    config: Record<string, unknown>
  } | null
}>()
const emit = defineEmits<{ created: [] }>()

const editing = computed(() => !!props.trigger)

const toast = useToast()
const toastError = useToastError()

type Source = 'schedule' | 'github' | 'manual' | 'jira'
const SOURCES: { key: Source, label: string, icon: string, hint: string }[] = [
  { key: 'schedule', label: 'Schedule', icon: 'i-lucide-clock', hint: 'Run on a cron schedule' },
  { key: 'github', label: 'GitHub', icon: 'i-simple-icons-github', hint: 'Run on GitHub events' },
  { key: 'jira', label: 'Jira', icon: 'i-simple-icons-jira', hint: 'Run on Jira tickets' },
  { key: 'manual', label: 'Manual', icon: 'i-lucide-play', hint: 'Run on demand only' },
]

const { data: projects } = useFetch('/api/projects', { default: () => [], lazy: true })

const source = ref<Source>('schedule')
const workflowId = ref<number>()
const projectIds = ref<number[]>([])
const config = ref<Record<string, unknown>>({})
const valid = ref(false)
const creating = ref(false)

// A Jira trigger fires for exactly one project, and only a linked one qualifies.
const projectItems = computed(() =>
  (projects.value ?? [])
    .filter(p => source.value !== 'jira' || p.jiraProjectKey)
    .map(p => ({ label: source.value === 'jira' ? `${p.fullName} · ${p.jiraProjectKey}` : p.fullName, value: p.id })),
)
const singleProject = computed({
  get: () => projectIds.value[0],
  set: (value: number | undefined) => {
    projectIds.value = value === undefined ? [] : [value]
  },
})
const jiraProjectKey = computed(() =>
  (projects.value ?? []).find(p => p.id === projectIds.value[0])?.jiraProjectKey ?? null)

// Sync: the edit preload sets the source first and the config right after.
watch(source, () => {
  config.value = {}
  valid.value = false
}, { flush: 'sync' })

const canCreate = computed(() =>
  !!workflowId.value
  && projectIds.value.length > 0
  && (source.value === 'manual' || valid.value),
)

function body(): Record<string, unknown> {
  const base: Record<string, unknown> = { source: source.value, projectIds: projectIds.value }
  if (source.value === 'schedule') base.cron = config.value.cron
  else base.config = config.value
  return base
}

async function create() {
  if (!canCreate.value) return
  creating.value = true
  try {
    if (props.trigger) {
      await $fetch(`/api/triggers/${props.trigger.id}`, { method: 'PATCH', body: body() })
      emit('created')
      toast.add({ title: 'Trigger updated', color: 'success' })
      open.value = false
      return
    }

    await $fetch('/api/triggers', { method: 'POST', body: { ...body(), workflowId: workflowId.value } })
    emit('created')
    toast.add({ title: 'Trigger created', color: 'success' })
    open.value = false
  }
  catch (e) {
    toastError(editing.value ? 'Failed to update trigger' : 'Failed to create trigger', e)
  }
  finally {
    creating.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    if (props.trigger) {
      source.value = props.trigger.source
      workflowId.value = props.trigger.workflowId
      projectIds.value = [...props.trigger.projectIds]
      config.value = props.trigger.source === 'schedule'
        ? { cron: props.trigger.endpoint ?? '0 9 * * *' }
        : { ...props.trigger.config }
      return
    }
    if (props.presetWorkflowId) workflowId.value = props.presetWorkflowId
    if (props.presetProjectIds?.length) projectIds.value = [...props.presetProjectIds]
    return
  }
  source.value = 'schedule'
  workflowId.value = undefined
  projectIds.value = []
  config.value = {}
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="editing ? 'Edit trigger' : 'New trigger'"
    :description="editing
      ? 'Change how and when this workflow runs automatically.'
      : 'Fire this workflow automatically.'"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div class="space-y-5">
        <div>
          <span class="k-label">Source</span>
          <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              v-for="src in SOURCES"
              :key="src.key"
              type="button"
              class="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-center transition-colors"
              :class="source === src.key
                ? 'border-(--primary-border) bg-(--lime-950)'
                : 'border-muted bg-(--surface-muted) hover:border-default'"
              @click="source = src.key"
            >
              <UIcon
                :name="src.icon"
                class="size-5"
                :class="source === src.key ? 'text-primary' : 'text-dimmed'"
              />
              <span
                class="text-xs font-medium"
                :class="source === src.key ? 'text-highlighted' : 'text-muted'"
              >{{ src.label }}</span>
              <span class="text-3xs leading-snug text-dimmed">{{ src.hint }}</span>
            </button>
          </div>
        </div>

        <div>
          <span class="k-label">{{ source === 'jira' ? 'Project' : 'Projects' }}</span>
          <USelectMenu
            v-if="source === 'jira'"
            v-model="singleProject"
            value-key="value"
            :items="projectItems"
            placeholder="Select a linked project…"
            icon="i-lucide-box"
            class="mt-2 w-full"
          />
          <USelectMenu
            v-else
            v-model="projectIds"
            value-key="value"
            multiple
            :items="projectItems"
            placeholder="Select projects…"
            icon="i-lucide-box"
            class="mt-2 w-full"
          />
          <p class="mt-2 text-2xs text-dimmed">
            {{ source === 'jira'
              ? 'Only projects linked to a Jira project (project settings) are listed; the trigger watches that Jira project.'
              : 'Fires the workflow once per selected project.' }}
          </p>
        </div>

        <KTriggerFormSchedule
          v-if="source === 'schedule'"
          v-model:config="config"
          v-model:valid="valid"
        />
        <KTriggerFormGithub
          v-else-if="source === 'github'"
          v-model:config="config"
          v-model:valid="valid"
        />
        <KTriggerFormJira
          v-else-if="source === 'jira'"
          v-model:config="config"
          v-model:valid="valid"
          :project-key="jiraProjectKey"
        />

        <div class="flex justify-end gap-2 pt-1">
          <UButton
            color="neutral"
            variant="outline"
            label="Cancel"
            @click="() => { open = false }"
          />
          <UButton
            :label="editing ? 'Save changes' : 'Create trigger'"
            color="primary"
            :loading="creating"
            :disabled="!canCreate"
            @click="create"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
