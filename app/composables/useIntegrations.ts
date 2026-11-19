import { liveTopics } from '#shared/utils/live-topics'
import { useLiveTopics } from '~/composables/useLiveTopics'
import { useFetch } from '#app'

export function useIntegrations() {
  useLiveTopics('integrations', [liveTopics.integrations])
  return useFetch('/api/integrations', { key: 'integrations', default: () => [] })
}
