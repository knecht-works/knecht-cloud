<script setup lang="ts">
import type { EnvTransition } from '#shared/utils/run'
import { liveTopics } from '#shared/utils/live-topics'
import type { SessionRun } from '~/composables/useSessionLogs'

const props = defineProps<{
  runId: number
  sessionId: number
  sessionRuns: SessionRun[]
}>()

const emit = defineEmits<{
  deleted: []
  started: [runId: number]
  changed: []
}>()

const id = props.runId

// Not awaited: a blocking async setup would re-trigger Suspense on every run switch.
const { data: run } = useRun(id)

const isLive = computed(() => isLiveStatus(run.value?.status))

const statusMeta = computed(() => runStatusMeta(run.value))

const previewOnline = computed(() =>
  run.value?.envState === 'up' && run.value.previewReady)

const meta = computed(() => {
  const r = run.value
  if (!r) return []
  // A branch is set locally by create-branch and pushed only by create-pr.
  const branchPushed = !!r.prUrl || !!r.sessionPrUrl || r.objects.some(o => o.kind === 'pull_request')
  return [
    ...r.objects.map((o) => {
      const object = sessionObjectMeta(o.integration, o.kind)
      return { icon: object.icon, text: `${object.prefix}${o.key}`, href: o.url ?? undefined }
    }),
    { icon: 'i-lucide-workflow', text: r.workflow, href: r.workflowId ? `/workflows/${r.workflowId}` : undefined },
    r.branch && {
      icon: 'i-lucide-git-branch',
      text: r.branch,
      href: branchPushed ? r.branchUrl ?? undefined : undefined,
    },
  ].filter(Boolean) as { icon: string, text: string, href?: string }[]
})

// Pull requests opened in an earlier run of the session belong to it as much as the latest run's.
const prs = computed(() => {
  const r = run.value
  if (!r) return []
  const objects = r.objects
    .filter(o => o.kind === 'pull_request' && o.url)
    .map(o => ({ url: o.url!, label: `Pull Request ${sessionObjectMeta(o.integration, o.kind).prefix}${o.key}` }))
  const fallback = r.prUrl ?? r.sessionPrUrl
  return objects.length || !fallback ? objects : [{ url: fallback, label: 'Pull Request' }]
})

const followupActive = ref(false)
const logRuns = useSessionLogs(props.sessionId, () => props.sessionRuns, () => followupActive.value)
const terminalOpen = ref(false)

const pending = ref<EnvTransition | null>(null)
const busy = computed(() => run.value?.envTransition ?? pending.value)

function refreshWorkspace() {
  return invalidate(liveTopics.run(id))
}
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
      :prs="prs"
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
      :has-env="run.hasEnv || run.previewLost"
      :preview-lost="run.previewLost"
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
      v-if="logRuns.length"
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
        :runs="logRuns"
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
