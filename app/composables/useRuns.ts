import { liveTopics } from '#shared/utils/live-topics'

export function useRuns(projectId?: number) {
  const key = projectId === undefined ? 'runs' : `runs:project:${projectId}`
  useLiveTopics(key, [liveTopics.runs])
  return useFetch('/api/runs', { key, query: projectId === undefined ? {} : { projectId }, default: () => [] })
}

export function useRunStats() {
  useLiveTopics('run-stats', [liveTopics.runs])
  return useFetch('/api/runs/stats', { key: 'run-stats', default: () => [] })
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
