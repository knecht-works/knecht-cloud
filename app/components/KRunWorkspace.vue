<script setup lang="ts">
import type { EnvTransition } from '#shared/utils/run'

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

const statusMeta = computed(() => runStatusMeta(run.value))

const previewOnline = computed(() =>
  run.value?.envState === 'up' && run.value.previewReady)

const timeline = computed(() => runLogTimeline(stepRows.value ?? [], run.value?.status))

const meta = computed(() => {
  const r = run.value
  if (!r) return []
  const object = r.objectIntegration && r.objectKind ? sessionObjectMeta(r.objectIntegration, r.objectKind) : null
  // A branch is set locally by create-branch and pushed only by create-pr.
  const branchOnGitHub = !!r.prUrl || r.objectKind === 'pull_request'
  return [
    object && {
      icon: object.icon,
      text: `${object.prefix}${r.objectKey}`,
      href: r.objectUrl ?? undefined,
    },
    { icon: 'i-lucide-workflow', text: r.workflow, href: r.workflowId ? `/workflows/${r.workflowId}` : undefined },
    r.branch && {
      icon: 'i-lucide-git-branch',
      text: r.branch,
      href: branchOnGitHub ? `https://github.com/${r.project}/tree/${r.branch}` : undefined,
    },
  ].filter(Boolean) as { icon: string, text: string, href?: string }[]
})

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
      :has-env="run.hasEnv"
      :preview-online="!!previewOnline"
      :is-live="isLive"
      :busy="busy"
      @changed="() => { refreshWorkspace(); emit('changed') }"
      @started="(runId) => emit('started', runId)"
      @pending="(t) => { pending = t }"
    />

    <KRunFollowupChat
      v-model:active="followupActive"
      :run-id="run.id"
      :session-id="run.sessionId"
      :status="run.status"
      :kind="run.kind"
      :env-state="run.envState"
      @changed="() => { refreshWorkspace(); emit('changed') }"
    />

    <KPanel
      v-if="run.kind !== 'mention'"
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
        resizable
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
