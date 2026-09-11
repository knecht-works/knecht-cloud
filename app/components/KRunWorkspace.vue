<script setup lang="ts">
import type { EnvTransition } from '#shared/utils/run'
import { stepsInclude, type Step } from '#shared/utils/workflow'

const props = defineProps<{ runId: number }>()

const emit = defineEmits<{
  deleted: []
  started: [runId: number]
  changed: []
}>()

const id = props.runId

// Lazy: a blocking async setup would re-trigger Suspense on every run switch.
const { data: run, refresh } = useFetch(`/api/runs/${id}`, { lazy: true })
const { data: stepRows, refresh: refreshSteps } = useFetch(`/api/runs/${id}/steps`, { lazy: true })

const isLive = computed(() => isLiveStatus(run.value?.status))

const hasBootStep = computed(() => {
  if (run.value?.kind === 'mention') return run.value.envState !== 'down'
  return stepsInclude((run.value?.steps ?? []) as Step[], 'ddev-start')
})
const statusMeta = computed(() => run.value ? RUN_STATUS_META[run.value.status] : IDLE_STATUS_META)

const previewOnline = computed(() =>
  run.value?.envState === 'up' && run.value.previewReady)

const timeline = computed(() => runLogTimeline(stepRows.value ?? []))

// The last row with an error is the most specific one: a composite is
// finalized after the child that failed it.
const failedStep = computed(() => {
  if (run.value?.status !== 'failed') return null
  return [...timeline.value].reverse().find(s => s.error) ?? null
})

const meta = computed(() => {
  const r = run.value
  if (!r) return []
  const trigger = r.trigger ? triggerSourceMeta(r.trigger) : null
  const object = r.objectKind ? sessionObjectMeta(r.objectKind) : null
  return [
    object && {
      icon: r.sessionStatus === 'closed' ? object.closedIcon : object.icon,
      text: `${object.label} #${r.objectNumber}`,
      href: r.objectUrl ?? undefined,
    },
    { icon: 'i-lucide-workflow', text: r.workflow, href: r.workflowId ? `/workflows/${r.workflowId}` : undefined },
    trigger && { icon: trigger.icon, text: trigger.label },
    r.branch && { icon: 'i-lucide-git-branch', text: r.branch },
    r.startedAt && { icon: 'i-lucide-timer', text: runDuration(r.startedAt, r.finishedAt) },
    r.createdAt && { icon: 'i-lucide-calendar', text: timeAgo(r.createdAt) },
  ].filter(Boolean) as { icon: string, text: string, href?: string }[]
})

const { retrying: bannerRetrying, retry: bannerRetry } = useRunRetry(id, () => refreshWorkspace())

const followupActive = ref(false)
const terminalOpen = ref(false)

const pending = ref<EnvTransition | null>(null)
const busy = computed(() => run.value?.envTransition ?? pending.value)

function refreshWorkspace() {
  return Promise.all([refresh(), refreshSteps()])
}

usePollWhile(() => isLive.value || followupActive.value || !!busy.value, refreshWorkspace)
</script>

<template>
  <!-- min-w-0: without it one long log line widens the 1fr grid track and pushes the sidebar off-screen. -->
  <div
    v-if="run"
    class="flex min-w-0 flex-col gap-4.5"
  >
    <KRunHeader
      :run-id="run.id"
      :status="run.status"
      :kind="run.kind"
      :env-state="run.envState"
      :busy="busy"
      :pr-url="run.prUrl"
      :is-live="isLive"
      :status-meta="statusMeta"
      :meta="meta"
      @changed="() => { refreshWorkspace(); emit('changed') }"
      @deleted="emit('deleted')"
      @open-terminal="terminalOpen = true"
      @pending="(t) => { pending = t }"
    />

    <KRunPreviewSection
      :run-id="run.id"
      :project-id="run.projectId"
      :workflow-id="run.workflowId"
      :session-id="run.sessionId"
      :preview-hosts="run.previewHosts ?? []"
      :has-preview-target="run.hasPreviewTarget"
      :env-state="run.envState"
      :has-boot-step="hasBootStep"
      :preview-online="!!previewOnline"
      :is-live="isLive"
      :busy="busy"
      @changed="() => { refreshWorkspace(); emit('changed') }"
      @started="(runId) => emit('started', runId)"
      @pending="(t) => { pending = t }"
    />

    <div
      v-if="run.status === 'failed'"
      class="k-card flex flex-wrap items-center justify-between gap-4 p-5"
    >
      <div class="min-w-0 max-w-130">
        <p class="text-2sm text-highlighted">
          <template v-if="failedStep">
            This run failed at "{{ failedStep.label }}" ({{ failedStep.stepId }}).
          </template>
          <template v-else>
            This run failed before a step could report an error.
          </template>
        </p>
        <p
          v-if="failedStep?.error"
          class="mt-1 text-xs"
          style="color: var(--status-error)"
        >
          {{ failedStep.error }}
        </p>
        <p
          v-else
          class="mt-1 text-xs text-muted"
        >
          Check the log below for details.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          v-if="run.workflowId"
          color="neutral"
          variant="outline"
          icon="i-lucide-workflow"
          :label="failedStep ? 'Fix failed step' : 'Edit workflow'"
          :to="`/workflows/${run.workflowId}${failedStep ? `?step=${encodeURIComponent(failedStep.stepId)}` : ''}`"
        />
        <UButton
          v-if="run.kind !== 'mention'"
          color="primary"
          icon="i-lucide-play"
          label="Retry"
          :loading="bannerRetrying"
          @click="bannerRetry"
        />
      </div>
    </div>

    <KRunFollowupChat
      v-model:active="followupActive"
      :run-id="run.id"
      :status="run.status"
      :env-state="run.envState"
      :pr-url="run.prUrl"
      @changed="() => { refreshWorkspace(); emit('changed') }"
    />

    <KPanel
      title="Log"
      icon="i-lucide-list-checks"
      :pad="0"
    >
      <template #action>
        <span class="flex items-center gap-2">
          <KStatusDot
            :color="statusMeta.dot"
            :pulse="statusMeta.pulse"
            :size="6"
          />
          <span
            class="k-mono text-2xs"
            :style="{ color: statusMeta.text }"
          >{{ statusMeta.label }}</span>
        </span>
      </template>
      <KRunLog
        :log="run.log"
        :rows="timeline"
        :live="isLive || followupActive"
        :run-status="run.status"
        :run-started-at="run.startedAt"
        :run-finished-at="run.finishedAt"
      />
    </KPanel>

    <KRunTerminalModal
      v-model:open="terminalOpen"
      :run-id="run.id"
    />
  </div>
  <div
    v-else
    class="flex items-center justify-center py-16"
  >
    <UIcon
      name="i-lucide-loader-circle"
      class="size-5 animate-spin text-dimmed"
    />
  </div>
</template>
