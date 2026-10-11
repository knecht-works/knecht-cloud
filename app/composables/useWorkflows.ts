import { liveTopics } from '#shared/utils/live-topics'

export function useWorkflows() {
  useLiveTopics('workflows', [liveTopics.workflows])
  return useFetch('/api/workflows', { key: 'workflows', default: () => [] })
}

export function useTriggers() {
  useLiveTopics('triggers', [liveTopics.triggers])
  return useFetch('/api/triggers', { key: 'triggers', default: () => [] })
}
