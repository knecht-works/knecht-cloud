import { liveTopics } from '#shared/utils/live-topics'
import { useLiveTopics } from '~/composables/useLiveTopics'
import { useFetch } from '#app'

export function useProjects() {
  useLiveTopics('projects', [liveTopics.projects])
  return useFetch('/api/projects', { key: 'projects', default: () => [] })
}

export function useProject(id: number) {
  const key = `project:${id}`
  useLiveTopics(key, [liveTopics.project(id)])
  return useFetch(`/api/projects/${id}`, { key })
}

// Session changes are published on the runs topic.
export function useProjectActivity() {
  useLiveTopics('project-activity', [liveTopics.runs])
  return useFetch('/api/projects/activity', { key: 'project-activity', default: () => [] })
}
