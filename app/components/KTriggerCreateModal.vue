<script setup lang="ts">
import { INTEGRATION_IDS, integrationRole, isTrackerId, type IntegrationId, type TriggerSource } from '#shared/utils/integrations'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  presetWorkflowId?: number
  presetProjectIds?: number[]
  trigger?: {
    id: number
    source: TriggerSource
    via: IntegrationId | null
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

type Tile = IntegrationId | 'schedule'
const TILES: { key: Tile, label: string, icon: string }[] = [
  { key: 'schedule', label: 'Schedule', icon: 'i-lucide-clock' },
  ...INTEGRATION_IDS.map(id => ({ key: id, ...integrationUi(id) })),
]

const { data: projects } = useProjects()
const { data: integrations } = useIntegrations()
const { data: forms } = useFetch('/api/triggers/forms', { key: 'trigger-forms' })

const tile = ref<Tile>(TILES[0]!.key)
const workflowId = ref<number>()
const projectIds = ref<number[]>([])
const config = ref<Record<string, unknown>>({})
const valid = ref(false)
const creating = ref(false)
const attempted = ref(false)

const source = computed<TriggerSource>(() => (tile.value === 'schedule' ? 'schedule' : integrationRole(tile.value)))
const integration = computed(() => integrations.value.find(i => i.id === tile.value) ?? null)
const form = computed(() => (source.value === 'git' ? forms.value?.git : integration.value?.triggerForm) ?? null)

const projectItems = computed(() => (projects.value ?? []).map(p => ({ label: p.fullName, value: p.id })))
const selectedProjects = computed(() => (projects.value ?? []).filter(p => projectIds.value.includes(p.id)))

// Only what every selected project supports: its repository's provider, a tracker it is linked to.
// A trigger being edited keeps its own tile, so a disconnected integration says so instead of vanishing.
const tiles = computed(() => TILES.filter(t => t.key === 'schedule' || t.key === props.trigger?.via
  || integrations.value.some(i => i.id === t.key && i.configured)))
const supported = (key: Tile) => selectedProjects.value.length > 0 && (key === 'schedule'
  || selectedProjects.value.every(p => (isTrackerId(key) ? !!p.links[key] : p.repoProvider === key)))
watch(selectedProjects, () => {
  if (selectedProjects.value.length && !supported(tile.value)) tile.value = tiles.value.find(t => supported(t.key))!.key
})

// What the form's option lists are keyed by: the tracker's link key, or the project for git.
const optionTargets = computed(() => selectedProjects.value.flatMap((p) => {
  if (!isTrackerId(tile.value)) return [{ key: String(p.id), name: p.fullName }]
  const key = p.links[tile.value]
  return key ? [{ key, name: key }] : []
}))

// Sync: the edit preload sets the tile first and the config right after.
watch(tile, () => {
  config.value = {}
  valid.value = false
  attempted.value = false
}, { flush: 'sync' })

const canCreate = computed(() => !!workflowId.value && projectIds.value.length > 0)

function body(): Record<string, unknown> {
  const base: Record<string, unknown> = { source: source.value, projectIds: projectIds.value }
  if (isTrackerId(tile.value)) base.integration = tile.value
  if (source.value === 'schedule') base.cron = config.value.cron
  else base.config = config.value
  return base
}

async function create() {
  attempted.value = true
  if (!canCreate.value || !valid.value) return
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
      tile.value = props.trigger.via ?? 'schedule'
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
  tile.value = TILES[0]!.key
  workflowId.value = undefined
  projectIds.value = []
  config.value = {}
  attempted.value = false
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="editing ? 'Edit trigger' : 'New trigger'"
    :description="editing
      ? 'Change how and when this workflow runs automatically.'
      : 'Fire this workflow automatically.'"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-4 min-h-130">
        <div class="space-y-4 h-full flex-1">
          <UFormField label="Projects">
            <USelectMenu
              v-model="projectIds"
              value-key="value"
              multiple
              :items="projectItems"
              icon="i-lucide-box"
              class="w-full"
            >
              <template #default>
                <span
                  v-if="projectIds.length"
                  class="flex flex-wrap gap-1"
                >
                  <span
                    v-for="item in projectItems.filter(p => projectIds.includes(p.value))"
                    :key="item.value"
                    class="k-code text-xs"
                  >{{ item.label }}</span>
                </span>
                <span
                  v-else
                  class="truncate text-dimmed"
                >Select projects…</span>
              </template>
            </USelectMenu>
          </UFormField>

          <fieldset
            :disabled="!projectIds.length"
            class="space-y-4 disabled:opacity-50"
          >
            <div>
              <div
                class="grid gap-2"
                :style="{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 150px))` }"
              >
                <button
                  v-for="src in tiles"
                  :key="src.key"
                  type="button"
                  class="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border p-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!supported(src.key)"
                  :class="tile === src.key
                    ? 'border-(--primary-border) bg-(--lime-950)'
                    : 'border-muted bg-(--surface-muted) enabled:hover:border-default'"
                  @click="tile = src.key"
                >
                  <UIcon
                    :name="src.icon"
                    class="size-5"
                    :class="tile === src.key ? 'text-primary' : 'text-dimmed'"
                  />
                  <span
                    class="text-xs font-medium"
                    :class="tile === src.key ? 'text-highlighted' : 'text-muted'"
                  >{{ src.label }}</span>
                </button>
              </div>
            </div>
            <div>
              <KTriggerFormSchedule
                v-if="source === 'schedule'"
                v-model:config="config"
                v-model:valid="valid"
              />
              <p
                v-else-if="integration && !integration.configured"
                class="rounded-md border border-muted bg-(--surface-muted) px-3 py-2.5 text-2xs leading-normal text-muted"
              >
                {{ integration.name }} is not connected yet. Connect it in
                <NuxtLink
                  to="/settings/integrations"
                  class="text-toned underline underline-offset-2"
                >Settings → Integrations</NuxtLink>
                first.
              </p>
              <KTriggerForm
                v-else-if="form"
                :key="tile"
                v-model:config="config"
                v-model:valid="valid"
                :form="form"
                :show-issues="attempted"
                :option-targets="optionTargets"
              />
            </div>
          </fieldset>
        </div>
        <div class="flex justify-end gap-2">
          <UButton
            size="lg"
            color="neutral"
            variant="outline"
            label="Cancel"
            @click="() => { open = false }"
          />
          <UButton
            size="lg"
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
