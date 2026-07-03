<script setup lang="ts">
// Create OR edit a trigger — the edit form mirrors create: source, projects and
// the source-specific settings (cron / GitHub event) are all editable. The
// workflow is never shown (the modal only opens from within a workflow, so it's
// implicit). A GitHub trigger shows its webhook URL + secret once, right after
// it's created or converted to GitHub.
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
  } | null
}>()
const emit = defineEmits<{ created: [] }>()

const editing = computed(() => !!props.trigger)

const toast = useToast()
const toastError = useToastError()

type Source = 'schedule' | 'github' | 'manual'
const SOURCES: { key: Source, label: string, icon: string, hint: string }[] = [
  { key: 'schedule', label: 'Schedule', icon: 'i-lucide-clock', hint: 'Run on a cron schedule' },
  { key: 'github', label: 'GitHub', icon: 'i-simple-icons-github', hint: 'Run on a repo webhook' },
  { key: 'manual', label: 'Manual', icon: 'i-lucide-play', hint: 'Run on demand only' },
]

const CRON_PRESETS = [
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily · 09:00', cron: '0 9 * * *' },
  { label: 'Weekdays · 09:00', cron: '0 9 * * 1-5' },
  { label: 'Weekly · Mon 09:00', cron: '0 9 * * 1' },
]

// Lazy: the modal is mounted (closed) on every workflow page — the project
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
const githubEvent = ref('push')
const creating = ref(false)

// A created GitHub trigger we still need to show the secret for, before closing.
const done = ref<{ endpoint: string | null, webhookSecret: string | null } | null>(null)

// Client-side gate only — the server validates the cron authoritatively.
const cronLooksValid = computed(() => cron.value.trim().split(/\s+/).length === 5)
const canCreate = computed(() =>
  !!workflow.value
  && projectIds.value.length > 0
  && (source.value !== 'schedule' || cronLooksValid.value),
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
      if (source.value === 'github') body.webhookEvent = githubEvent.value
      const updated = await $fetch(`/api/triggers/${props.trigger.id}`, { method: 'PATCH', body })
      emit('created')
      // If the edit turned it into a GitHub trigger, show its secret once.
      if (updated.webhookSecret) {
        done.value = { endpoint: updated.endpoint ?? null, webhookSecret: updated.webhookSecret }
      }
      else {
        toast.add({ title: 'Trigger updated', color: 'success' })
        open.value = false
      }
      return
    }

    const body: Record<string, unknown> = {
      source: source.value,
      workflow: workflow.value,
      projectIds: projectIds.value,
    }
    if (source.value === 'schedule') body.cron = cron.value.trim()
    if (source.value === 'github') body.webhookEvent = githubEvent.value

    const created = await $fetch('/api/triggers', { method: 'POST', body })
    emit('created')

    if (source.value === 'github') {
      done.value = { endpoint: created.endpoint ?? null, webhookSecret: created.webhookSecret ?? null }
    }
    else {
      toast.add({ title: 'Trigger created', color: 'success' })
      open.value = false
    }
  }
  catch (e) {
    toastError(editing.value ? 'Failed to update trigger' : 'Failed to create trigger', e)
  }
  finally {
    creating.value = false
  }
}

function copy(text: string | null) {
  if (text) {
    navigator.clipboard?.writeText(text)
    toast.add({ title: 'Copied', color: 'success' })
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
      githubEvent.value = props.trigger.webhookEvent ?? 'push'
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
  done.value = null
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
      <!-- After creating a GitHub trigger: show the webhook URL + secret once. -->
      <div
        v-if="done"
        class="space-y-4"
      >
        <div class="flex flex-col items-center gap-3 py-1 text-center">
          <span class="grid size-11 place-items-center rounded-full border border-(--primary-border) bg-(--lime-950) text-(--primary)">
            <UIcon
              name="i-lucide-check"
              class="size-5"
            />
          </span>
          <p class="text-[14px] font-medium text-(--text-highlighted)">
            GitHub trigger created
          </p>
          <p class="mx-auto max-w-[380px] text-[12.5px] leading-[1.5] text-(--text-dimmed)">
            Add a webhook to the repo with the URL and secret below
            (<span class="k-mono">Settings → Webhooks</span>), content type
            <span class="k-mono">application/json</span>. Knecht must be reachable at a public URL.
          </p>
        </div>

        <div>
          <span class="k-label">Payload URL</span>
          <div class="mt-1.5 flex items-center gap-2 rounded-(--radius-md) border border-(--border-muted) bg-(--surface-muted) px-3 py-2.5">
            <span class="k-mono flex-1 truncate text-[12px] text-(--text-muted)">{{ done.endpoint || '— set KNECHT_BASE_DOMAIN —' }}</span>
            <UButton
              icon="i-lucide-copy"
              color="neutral"
              variant="ghost"
              size="xs"
              :disabled="!done.endpoint"
              @click="copy(done.endpoint)"
            />
          </div>
        </div>

        <div>
          <span class="k-label">Secret</span>
          <div class="mt-1.5 flex items-center gap-2 rounded-(--radius-md) border border-(--border-muted) bg-(--surface-muted) px-3 py-2.5">
            <span class="k-mono flex-1 truncate text-[12px] text-(--text-muted)">{{ done.webhookSecret }}</span>
            <UButton
              icon="i-lucide-copy"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="copy(done.webhookSecret)"
            />
          </div>
          <p class="k-mono mt-2 text-[11px] text-(--text-dimmed)">
            Shown once — copy it now.
          </p>
        </div>

        <div class="flex justify-end">
          <UButton
            label="Done"
            color="primary"
            @click="() => { open = false }"
          />
        </div>
      </div>

      <!-- Trigger form -->
      <div
        v-else
        class="space-y-5"
      >
        <!-- Source -->
        <div>
          <span class="k-label">Source</span>
          <div class="mt-2 grid grid-cols-3 gap-2">
            <button
              v-for="src in SOURCES"
              :key="src.key"
              type="button"
              class="flex cursor-pointer flex-col items-center gap-1.5 rounded-(--radius-md) border px-2 py-3 text-center transition-colors"
              :class="source === src.key
                ? 'border-(--primary-border) bg-(--lime-950)'
                : 'border-(--border-muted) bg-(--surface-muted) hover:border-(--border-default)'"
              @click="source = src.key"
            >
              <UIcon
                :name="src.icon"
                class="size-5"
                :class="source === src.key ? 'text-(--primary)' : 'text-(--text-dimmed)'"
              />
              <span
                class="text-[12.5px] font-medium"
                :class="source === src.key ? 'text-(--text-highlighted)' : 'text-(--text-muted)'"
              >{{ src.label }}</span>
              <span class="text-[10.5px] leading-[1.3] text-(--text-dimmed)">{{ src.hint }}</span>
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
          <p class="mt-2 text-[11.5px] text-(--text-dimmed)">
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
              class="k-mono cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors"
              :class="cron.trim() === p.cron
                ? 'border-(--primary-border) bg-(--lime-950) text-(--primary)'
                : 'border-(--border-default) text-(--text-dimmed) hover:text-(--text-muted)'"
              @click="cron = p.cron"
            >
              {{ p.label }}
            </button>
          </div>
          <p
            v-if="!cronLooksValid"
            class="mt-2 text-[11.5px] text-(--status-error)"
          >
            A cron expression has 5 fields: minute hour day month weekday.
          </p>
        </div>

        <!-- GitHub: event -->
        <div v-else-if="source === 'github'">
          <span class="k-label">GitHub event</span>
          <USelectMenu
            v-model="githubEvent"
            value-key="value"
            :items="[{ label: 'Push', value: 'push' }, { label: 'Pull request', value: 'pull_request' }]"
            class="mt-2 w-full"
          />
          <!-- Already a GitHub trigger → show its webhook URL (copyable); the
               secret was only shown once, at creation. -->
          <div
            v-if="editing && trigger?.source === 'github'"
            class="mt-3"
          >
            <span class="k-label">Payload URL</span>
            <div class="mt-1.5 flex items-center gap-2 rounded-(--radius-md) border border-(--border-muted) bg-(--surface-muted) px-3 py-2.5">
              <span class="k-mono flex-1 truncate text-[12px] text-(--text-muted)">{{ trigger.endpoint || '— set KNECHT_BASE_DOMAIN —' }}</span>
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="!trigger.endpoint"
                @click="copy(trigger.endpoint)"
              />
            </div>
            <p class="k-mono mt-2 text-[11px] text-(--text-dimmed)">
              The secret was shown once at creation.
            </p>
          </div>
          <p
            v-else
            class="mt-2 text-[11.5px] text-(--text-dimmed)"
          >
            The webhook URL + secret to set on GitHub are shown after you save.
          </p>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <UButton
            color="neutral"
            variant="ghost"
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
