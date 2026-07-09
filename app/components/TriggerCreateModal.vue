<script setup lang="ts">
// Create OR edit a trigger. The edit form mirrors create: source, projects and
// the source-specific settings (cron / GitHub event) are all editable. The
// workflow is never shown (the modal only opens from within a workflow, so it's
// implicit). GitHub triggers need no setup here: events arrive via the GitHub
// App webhook, configured automatically when the app was created at setup.
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  presetWorkflow?: string
  presetProjectIds?: number[]
  /** Edit this trigger instead of creating one. */
  trigger?: {
    id: number
    source: 'schedule' | 'github' | 'manual'
    workflow: string
    projectIds: number[]
    endpoint: string | null
    webhookEvent: string | null
    webhookBranches: string[]
    issueActions: ('opened' | 'labeled')[]
    issueLabel: string | null
  } | null
}>()
const emit = defineEmits<{ created: [] }>()

const editing = computed(() => !!props.trigger)

const toast = useToast()
const toastError = useToastError()

type Source = 'schedule' | 'github' | 'manual'
const SOURCES: { key: Source, label: string, icon: string, hint: string }[] = [
  { key: 'schedule', label: 'Schedule', icon: 'i-lucide-clock', hint: 'Run on a cron schedule' },
  { key: 'github', label: 'GitHub', icon: 'i-simple-icons-github', hint: 'Run on GitHub events' },
  { key: 'manual', label: 'Manual', icon: 'i-lucide-play', hint: 'Run on demand only' },
]

const CRON_PRESETS = [
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily · 09:00', cron: '0 9 * * *' },
  { label: 'Weekdays · 09:00', cron: '0 9 * * 1-5' },
  { label: 'Weekly · Mon 09:00', cron: '0 9 * * 1' },
]

// Lazy: the modal is mounted (closed) on every workflow page, so the project
// list only matters once it opens, so it must not block the page.
const { data: projects } = useFetch('/api/projects', {
  default: () => [],
  lazy: true,
  transform: rows => rows.map(p => ({ label: p.fullName, value: p.id })),
})

const source = ref<Source>('schedule')
const workflow = ref<string>()
const projectIds = ref<number[]>([])
const cron = ref('0 9 * * *')
const githubEvent = ref<'push' | 'pull_request' | 'issues'>('push')
// Comma-separated branch filter (push: the pushed branch, PR: the base branch);
// empty = every branch.
const branchFilter = ref('')
const issueOpened = ref(true)
const issueLabeled = ref(false)
const issueLabel = ref('')
const creating = ref(false)

function parsedBranches(): string[] {
  return branchFilter.value.split(',').map(b => b.trim()).filter(Boolean)
}

function issueActions(): ('opened' | 'labeled')[] {
  return [
    ...(issueOpened.value ? ['opened'] as const : []),
    ...(issueLabeled.value ? ['labeled'] as const : []),
  ]
}

// Client-side gate only. The server validates the cron authoritatively.
const cronLooksValid = computed(() => cron.value.trim().split(/\s+/).length === 5)
const issuesLookValid = computed(() =>
  githubEvent.value !== 'issues'
  || (issueActions().length > 0 && (!issueLabeled.value || !!issueLabel.value.trim())),
)
const canCreate = computed(() =>
  !!workflow.value
  && projectIds.value.length > 0
  && (source.value !== 'schedule' || cronLooksValid.value)
  && (source.value !== 'github' || issuesLookValid.value),
)

async function create() {
  if (!canCreate.value) return
  creating.value = true
  try {
    if (props.trigger) {
      const body: Record<string, unknown> = {
        source: source.value,
        projectIds: projectIds.value,
      }
      if (source.value === 'schedule') body.cron = cron.value.trim()
      if (source.value === 'github') {
        body.webhookEvent = githubEvent.value
        body.webhookBranches = parsedBranches()
        body.issueActions = issueActions()
        body.issueLabel = issueLabeled.value ? issueLabel.value.trim() : null
      }
      await $fetch(`/api/triggers/${props.trigger.id}`, { method: 'PATCH', body })
      emit('created')
      toast.add({ title: 'Trigger updated', color: 'success' })
      open.value = false
      return
    }

    const body: Record<string, unknown> = {
      source: source.value,
      workflow: workflow.value,
      projectIds: projectIds.value,
    }
    if (source.value === 'schedule') body.cron = cron.value.trim()
    if (source.value === 'github') {
      body.webhookEvent = githubEvent.value
      body.webhookBranches = parsedBranches()
      body.issueActions = issueActions()
      body.issueLabel = issueLabeled.value ? issueLabel.value.trim() : null
    }

    await $fetch('/api/triggers', { method: 'POST', body })
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

// Prefill from the trigger being edited or the opening context; reset to a
// fresh form on close.
watch(open, (isOpen) => {
  if (isOpen) {
    if (props.trigger) {
      source.value = props.trigger.source
      workflow.value = props.trigger.workflow
      projectIds.value = [...props.trigger.projectIds]
      if (props.trigger.source === 'schedule' && props.trigger.endpoint) {
        cron.value = props.trigger.endpoint
      }
      githubEvent.value = (props.trigger.webhookEvent ?? 'push') as typeof githubEvent.value
      branchFilter.value = props.trigger.webhookBranches.join(', ')
      issueOpened.value = props.trigger.issueActions.includes('opened')
      issueLabeled.value = props.trigger.issueActions.includes('labeled')
      issueLabel.value = props.trigger.issueLabel ?? ''
      return
    }
    if (props.presetWorkflow) workflow.value = props.presetWorkflow
    if (props.presetProjectIds?.length) projectIds.value = [...props.presetProjectIds]
    return
  }
  source.value = 'schedule'
  workflow.value = undefined
  projectIds.value = []
  cron.value = '0 9 * * *'
  githubEvent.value = 'push'
  branchFilter.value = ''
  issueOpened.value = true
  issueLabeled.value = false
  issueLabel.value = ''
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
        <!-- Source -->
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

        <!-- Projects -->
        <div>
          <span class="k-label">Projects</span>
          <USelectMenu
            v-model="projectIds"
            value-key="value"
            multiple
            :items="projects"
            placeholder="Select projects…"
            icon="i-lucide-box"
            class="mt-2 w-full"
          />
          <p class="mt-2 text-2xs text-dimmed">
            Fires the workflow once per selected project.
          </p>
        </div>

        <!-- Schedule: cron -->
        <div v-if="source === 'schedule'">
          <span class="k-label">Schedule</span>
          <UInput
            v-model="cron"
            placeholder="0 9 * * *"
            class="mt-2 w-full"
            :ui="{ base: 'k-mono' }"
          />
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="p in CRON_PRESETS"
              :key="p.cron"
              type="button"
              class="k-mono cursor-pointer rounded-full border px-2.5 py-1 text-2xs transition-colors"
              :class="cron.trim() === p.cron
                ? 'border-(--primary-border) bg-(--lime-950) text-primary'
                : 'border-default text-dimmed hover:text-muted'"
              @click="cron = p.cron"
            >
              {{ p.label }}
            </button>
          </div>
          <p
            v-if="!cronLooksValid"
            class="mt-2 text-2xs text-error"
          >
            A cron expression has 5 fields: minute hour day month weekday.
          </p>
        </div>

        <!-- GitHub: event + filters -->
        <div
          v-else-if="source === 'github'"
          class="space-y-4"
        >
          <div>
            <span class="k-label">GitHub event</span>
            <USelectMenu
              v-model="githubEvent"
              value-key="value"
              :items="[
                { label: 'Push', value: 'push' },
                { label: 'Pull request', value: 'pull_request' },
                { label: 'Issues', value: 'issues' },
              ]"
              class="mt-2 w-full"
            />
          </div>

          <!-- Push / PR: branch filter -->
          <div v-if="githubEvent !== 'issues'">
            <span class="k-label">{{ githubEvent === 'pull_request' ? 'Base branches' : 'Branches' }}</span>
            <UInput
              v-model="branchFilter"
              placeholder="main, staging"
              class="mt-2 w-full"
              :ui="{ base: 'k-mono' }"
            />
            <p class="mt-2 text-2xs text-dimmed">
              {{ githubEvent === 'pull_request'
                ? 'Fires when a pull request targeting one of these branches is opened or pushed to. Comma-separated, empty = every branch.'
                : 'Fires on pushes to these branches. Comma-separated, empty = every branch.' }}
            </p>
          </div>

          <!-- Issues: which actions, optionally gated on a label -->
          <div v-else>
            <span class="k-label">Fires when</span>
            <div class="mt-2 space-y-2">
              <UCheckbox
                v-model="issueOpened"
                label="An issue is opened"
              />
              <UCheckbox
                v-model="issueLabeled"
                label="A label is added"
              />
              <UInput
                v-if="issueLabeled"
                v-model="issueLabel"
                placeholder="Label name, e.g. knecht"
                class="w-full"
                :ui="{ base: 'k-mono' }"
              />
            </div>
            <p
              v-if="!issuesLookValid"
              class="mt-2 text-2xs text-error"
            >
              {{ issueLabeled && !issueLabel.trim()
                ? 'Name the label that fires the trigger.'
                : 'Pick at least one issue event.' }}
            </p>
          </div>

          <p class="text-2xs text-dimmed">
            Events arrive via the GitHub App webhook (see Settings); no per-repo setup needed.
          </p>
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
