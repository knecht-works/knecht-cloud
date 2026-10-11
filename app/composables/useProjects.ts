import { liveTopics } from '#shared/utils/live-topics'

export function useProjects() {
  useLiveTopics('projects', [liveTopics.projects])
  return useFetch('/api/projects', { key: 'projects', default: () => [] })
}

export function useProject(id: number) {
  const key = `project:${id}`
  useLiveTopics(key, [liveTopics.project(id)])
  return useFetch(`/api/projects/${id}`, { key })
}
