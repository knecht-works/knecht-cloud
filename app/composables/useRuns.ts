import { liveTopics } from '#shared/utils/live-topics'
import { computeRunStats, type RunStats } from '#shared/utils/run-stats'
import { useLiveTopics } from '~/composables/useLiveTopics'
import { useFetch } from '#app'
import { ref, onMounted, computed } from 'vue'

export function useRuns(projectId?: number) {
  const key = projectId === undefined ? 'runs' : `runs:project:${projectId}`
  useLiveTopics(key, [liveTopics.runs])
  return useFetch('/api/runs', { key, query: projectId === undefined ? {} : { projectId }, default: () => [] })
}

export function useRunStats() {
  useLiveTopics('run-stats', [liveTopics.runs])
  return useFetch('/api/runs/stats', { key: 'run-stats', default: () => [] })
}

// Stats bucket by the viewer's local days, which the server can't know, so they wait for hydration.
export function useRunStatsBy(key: 'projectId' | 'workflowId') {
  const { data } = useRunStats()
  const hydrated = ref(false)
  onMounted(() => {
    hydrated.value = true
  })
  return computed(() => {
    const grouped = new Map<number, NonNullable<typeof data.value>>()
    if (!hydrated.value) return new Map<number, RunStats>()
    for (const r of data.value ?? []) {
      const id = r[key]
      if (id !== null) grouped.set(id, [...(grouped.get(id) ?? []), r])
    }
    const now = new Date()
    return new Map([...grouped].map(([id, list]) => [id, computeRunStats(list, now)]))
  })
}

export function useRun(id: number) {
  const key = `run:${id}`
  useLiveTopics(key, [liveTopics.run(id)])
  return useFetch(`/api/runs/${id}`, { key })
}

export function useRunSteps(id: number) {
  const key = `run-steps:${id}`
  useLiveTopics(key, [liveTopics.run(id)])
  return useFetch(`/api/runs/${id}/steps`, { key, default: () => [] })
}

// The environment reports going up or down on the run's topic.
export function useRunServices(id: number) {
  const key = `run-services:${id}`
  useLiveTopics(key, [liveTopics.run(id)])
  return useFetch(`/api/runs/${id}/services`, { key, lazy: true, default: () => [] })
}
