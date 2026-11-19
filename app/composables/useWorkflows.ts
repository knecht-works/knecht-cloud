import { liveTopics } from '#shared/utils/live-topics'
import { useLiveTopics } from '~/composables/useLiveTopics'
import { useFetch } from '#app'

export function useWorkflows() {
  useLiveTopics('workflows', [liveTopics.workflows])
  return useFetch('/api/workflows', { key: 'workflows', default: () => [] })
}

export function useTriggers() {
  useLiveTopics('triggers', [liveTopics.triggers])
  return useFetch('/api/triggers', { key: 'triggers', default: () => [] })
}
