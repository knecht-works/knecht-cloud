<script setup lang="ts">
import { stepsInclude, type Step } from '#shared/utils/workflow'

// One run's full workspace: header, preview, follow-up chat and the run log
// as one continuous stream with a step index rail beside it (KRunLog:
// clicking a step scrolls the log to that step's byte offset). Split across
// KRunHeader/KRunPreviewSection/KRunFollowupChat/KRunTerminalModal, each
// owning its own mutations and emitting `changed` for this shell to refresh
// on; this file keeps only the run/steps fetch, the computed state several
// of them share, and the layout. Rendered inside the project page for the
// selected run; the parent keys this component by runId so switching runs
// remounts everything (preview history, terminal, fetches) from scratch.
const props = defineProps<{ runId: number }>()

const emit = defineEmits<{
  /** The run was deleted; the parent picks the next run. */
  deleted: []
  /** "Run again" created a fresh run; the parent selects it. */
  started: [runId: number]
  /** Cancel/retry/reboot changed the run's status or env state; the parent
   *  refreshes its runs list so the sidebar row matches. */
  changed: []
}>()

const id = props.runId

// Lazy (not awaited): the component mounts client-side whenever the selected
// run changes, and a blocking async setup would re-trigger Suspense on every
// switch. The template guards on `run` instead.
const { data: run, refresh } = useFetch(`/api/runs/${id}`, { lazy: true })
const { data: stepRows, refresh: refreshSteps } = useFetch(`/api/runs/${id}/steps`, { lazy: true })

const isLive = computed(() => isLiveStatus(run.value?.status))

// A boot step in the pinned sequence means a preview is coming; without one
// (a workflow that never boots an env) the preview frame isn't rendered at
// all. A mention run has no steps of its own but works in the session's
// environment (booted by a starter or earlier run), so its preview shows as
// long as that environment still exists.
const hasBootStep = computed(() => {
  if (run.value?.kind === 'mention') return run.value.envState !== 'down'
  return stepsInclude((run.value?.steps ?? []) as Step[], 'ddev-start')
})
const statusMeta = computed(() => run.value ? RUN_STATUS_META[run.value.status] : IDLE_STATUS_META)

// Browsable only once the boot step finished (previewReady), not the moment
// the containers run.
const previewOnline = computed(() =>
  run.value?.envState === 'up' && run.value.previewReady)

// The step timeline behind KRunLog, shared with the workflow editor's test
// run (utils/run-log.ts).
const timeline = computed(() => runLogTimeline(stepRows.value ?? []))

// The step behind the failure card: rows are in execution order, so the last
// row carrying an error is the most specific one (a composite is finalized
// after the child that failed it). Null when the run failed before any step
// recorded an error (e.g. a runner crash); the card then points at the log.
const failedStep = computed(() => {
  if (run.value?.status !== 'failed') return null
  return [...timeline.value].reverse().find(s => s.error) ?? null
})

// The run's meta facts (the session's issue/PR, the workflow it executes,
// how it was triggered, the branch it works on, timing). Chips are skipped
// when a run predates the recorded field. The workflow chip links to the
// editor (plain text once the workflow was deleted). The PR gets no chip:
// the header's "Open Pull Request" button already covers it.
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

// Retry from the failed-step banner: same request as the header's Retry
// button (cancelled runs), different trigger, mutually exclusive statuses.
const { retrying: bannerRetrying, retry: bannerRetry } = useRunRetry(id, () => refreshWorkspace())

const followupActive = ref(false)
const terminalOpen = ref(false)

function refreshWorkspace() {
  return Promise.all([refresh(), refreshSteps()])
}

usePollWhile(() => isLive.value || followupActive.value, refreshWorkspace)
</script>

<template>
  <!-- min-w-0: as a grid item in the project page's [1fr|sidebar] grid, the
       default min-width:auto would let one long unbroken log line widen the
       1fr track past the viewport and push the sidebar off-screen. -->
  <div
    v-if="run"
    class="flex min-w-0 flex-col gap-4.5"
  >
    <KRunHeader
      :run-id="run.id"
      :status="run.status"
      :kind="run.kind"
      :env-state="run.envState"
      :pr-url="run.prUrl"
      :is-live="isLive"
      :status-meta="statusMeta"
      :meta="meta"
      @changed="() => { refreshWorkspace(); emit('changed') }"
      @deleted="emit('deleted')"
      @open-terminal="terminalOpen = true"
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
      @changed="() => { refreshWorkspace(); emit('changed') }"
      @started="(runId) => emit('started', runId)"
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

    <!-- The full run log, continuous, with a step index rail: clicking a
         step scrolls the log to that step's recorded byte offset. Nothing is
         hidden: retry banners, agent-git lines and the closing ✓/✗ sit in
         the segment they chronologically belong to. -->
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
