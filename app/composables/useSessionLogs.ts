import { liveTopics } from '#shared/utils/live-topics'
import type { LogRun } from '~/components/KRunLog.vue'
import type { RunStatus } from '~/utils/dashboard'
import { runLogTimeline } from '~/utils/run-log'
import { useFetch } from '#app'
import { watch, computed, shallowRef } from 'vue'
import { isLiveStatus } from '~/utils/dashboard'
import { useRunLog } from '~/composables/useRunLog'
import { $fetch } from '#build/fetch.mjs'
import { onLiveTopics } from '~/composables/useLiveTopics'

export interface SessionRun {
  id: number
  kind: 'workflow' | 'mention'
  workflow: string
  status: RunStatus
  startedAt: string | number | Date | null
  finishedAt: string | number | Date | null
}

// Finished runs load once per status change; only one run streams, as follow-ups keep appending to it.
export function useSessionLogs(sessionId: number, runs: () => SessionRun[], followupActive: () => boolean) {
  const { data, refresh } = useFetch(`/api/sessions/${sessionId}/logs`, { key: `session-logs:${sessionId}`, default: () => [] })
  watch(() => runs().map(r => `${r.id}:${r.status}`).join(), () => refresh())

  const workflowRuns = computed(() => runs().filter(r => r.kind === 'workflow').sort((a, b) => a.id - b.id))
  const streamedId = computed(() =>
    workflowRuns.value.find(r => isLiveStatus(r.status))?.id ?? workflowRuns.value.at(-1)?.id ?? null)

  const streamedLog = useRunLog(streamedId)
  const streamedSteps = shallowRef<{ runId: number, steps: (typeof data.value)[number]['steps'] } | null>(null)
  async function loadStreamedSteps() {
    const runId = streamedId.value
    if (!runId) return
    const steps = await $fetch(`/api/runs/${runId}/steps`)
    if (runId === streamedId.value) streamedSteps.value = { runId, steps }
  }
  if (import.meta.client) watch(streamedId, loadStreamedSteps, { immediate: true })
  onLiveTopics(() => streamedId.value ? [liveTopics.run(streamedId.value)] : [], loadStreamedSteps)

  return computed<LogRun[]>(() => {
    const loaded = new Map(data.value.map(l => [l.runId, l]))
    return workflowRuns.value.map((r) => {
      const streamed = r.id === streamedId.value
      const steps = (streamed && streamedSteps.value?.runId === r.id ? streamedSteps.value.steps : null) ?? loaded.get(r.id)?.steps ?? []
      return {
        id: r.id,
        label: r.workflow,
        log: (streamed && streamedLog.value) || (loaded.get(r.id)?.log ?? ''),
        rows: runLogTimeline(steps, r.status),
        live: streamed && (isLiveStatus(r.status) || followupActive()),
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      }
    })
  })
}
