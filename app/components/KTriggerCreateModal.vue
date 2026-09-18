<script setup lang="ts">
import { INTEGRATION_IDS, type TriggerSource } from '#shared/utils/integrations'
import KTriggerFormSchedule from '~/components/KTriggerFormSchedule.vue'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  presetWorkflowId?: number
  presetProjectIds?: number[]
  trigger?: {
    id: number
    source: TriggerSource
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

type Source = TriggerSource
const SOURCES: { key: Source, label: string, icon: string, hint: string }[] = [
  { key: 'schedule', label: 'Schedule', icon: 'i-lucide-clock', hint: 'Run on a cron schedule' },
  ...INTEGRATION_IDS.map(id => ({ key: id, ...integrationUi(id) })),
]

const { data: projects } = useFetch('/api/projects', { default: () => [], lazy: true })
const { data: integrations } = useFetch('/api/integrations', { default: () => [], lazy: true })

const source = ref<Source>('schedule')
const workflowId = ref<number>()
const projectIds = ref<number[]>([])
const config = ref<Record<string, unknown>>({})
const valid = ref(false)
const creating = ref(false)

const integration = computed(() => integrations.value.find(i => i.id === source.value) ?? null)
const linked = computed(() => !!integration.value?.link)
const linkKeyOf = (p: { links: Partial<Record<string, string>> }) => (integration.value ? p.links[integration.value.id] : undefined) ?? null
const triggerForm = computed(() =>
  source.value === 'schedule' ? KTriggerFormSchedule : integration.value ? integrationUi(integration.value.id).triggerForm : null)

// A linked integration's trigger only takes projects that are linked.
const projectItems = computed(() =>
  (projects.value ?? [])
    .filter(p => !linked.value || linkKeyOf(p))
    .map(p => ({ label: linked.value ? `${p.fullName} · ${linkKeyOf(p)}` : p.fullName, value: p.id })),
)
const selectedLinkKeys = computed(() =>
  (projects.value ?? [])
    .filter(p => projectIds.value.includes(p.id))
    .map(linkKeyOf)
    .filter((key): key is string => !!key),
)

// Sync: the edit preload sets the source first and the config right after.
watch(source, () => {
  config.value = {}
  valid.value = false
}, { flush: 'sync' })

const canCreate = computed(() =>
  !!workflowId.value
  && projectIds.value.length > 0
  && valid.value,
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
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-5">
        <div>
          <span class="k-label">Source</span>
          <div class="mt-2 grid grid-cols-3 gap-2">
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
          <span class="k-label">Projects</span>
          <USelectMenu
            v-model="projectIds"
            value-key="value"
            multiple
            :items="projectItems"
            placeholder="Select projects…"
            icon="i-lucide-box"
            class="mt-2 w-full"
          />
          <p class="mt-2 text-2xs text-dimmed">
            {{ linked
              ? `Only projects linked to a ${integration?.link?.label} (project settings) are listed. Fires the workflow once per selected project.`
              : 'Fires the workflow once per selected project.' }}
          </p>
        </div>

        <div class="min-h-72">
          <component
            :is="triggerForm"
            v-if="triggerForm"
            v-model:config="config"
            v-model:valid="valid"
            v-bind="linked ? { linkKeys: selectedLinkKeys } : {}"
          />
        </div>

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
