<script setup lang="ts">
import type { EnvTransition } from '#shared/utils/run'
import { liveTopics } from '#shared/utils/live-topics'
import type { SessionRun } from '~/composables/useSessionLogs'
import type { SessionGroup, SessionHeaderRun } from '~/utils/dashboard'
import { useRun } from '~/composables/useRuns'
import { computed, ref } from 'vue'
import { isLiveStatus, runStatusMeta, sessionObjectMeta } from '~/utils/dashboard'
import { useSessionLogs } from '~/composables/useSessionLogs'
import { invalidate } from '~/composables/useLiveTopics'
import KRunHeader from '~/components/KRunHeader.vue'
import KPreviewShareButton from '~/components/KPreviewShareButton.vue'
import KSessionHeader from '~/components/KSessionHeader.vue'
import KRunPreviewSection from '~/components/KRunPreviewSection.vue'
import KRunFollowupChat from '~/components/KRunFollowupChat.vue'
import KStatusDot from '~/components/KStatusDot.vue'
import KRunLog from '~/components/KRunLog.vue'
import KPanel from '~/components/KPanel.vue'
import KRunTerminalModal from '~/components/KRunTerminalModal.vue'
import { UIcon } from '#components'

const props = defineProps<{
  runId: number
  sessionId: number
  sessionRuns: SessionRun[]
  group: SessionGroup<SessionHeaderRun>
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

const header = computed(() => {
  const r = run.value!
  return {
    runId: r.id,
    sessionId: r.sessionId,
    projectId: r.projectId,
    workflowId: r.workflowId,
    hasEnv: r.hasEnv || r.previewLost,
    status: r.status,
    kind: r.kind,
    envState: r.envState,
    busy: busy.value,
    prs: prs.value,
    isLive: isLive.value,
  }
})
const headerEvents = {
  changed: () => {
    refreshWorkspace()
    emit('changed')
  },
  deleted: () => emit('deleted'),
  started: (runId: number) => emit('started', runId),
  openTerminal: () => { terminalOpen.value = true },
  pending: (t: EnvTransition | null) => { pending.value = t },
}
</script>

<template>
  <!-- min-w-0: without it one long log line widens the 1fr grid track and pushes the sidebar off-screen. -->
  <div
    v-if="run"
    class="flex min-w-0 flex-col gap-4.5"
  >
    <KSessionHeader :group="group">
      <KRunHeader
        v-bind="header"
        v-on="headerEvents"
      />
    </KSessionHeader>
    <slot name="status" />

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
    >
      <template #actions>
        <KPreviewShareButton :session-id="run.sessionId" />
      </template>
    </KRunPreviewSection>

    <KRunFollowupChat
      v-model:active="followupActive"
      :run-id="run.id"
      :session-id="run.sessionId"
      :project-id="run.projectId"
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
