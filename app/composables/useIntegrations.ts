import { liveTopics } from '#shared/utils/live-topics'
import { useLiveTopics } from '~/composables/useLiveTopics'
import { useFetch } from '#imports'

export function useIntegrations() {
  useLiveTopics('integrations', [liveTopics.integrations])
  return useFetch('/api/integrations', { key: 'integrations', default: () => [] })
}
