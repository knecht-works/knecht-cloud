import { liveTopics } from '#shared/utils/live-topics'

export function useIntegrations() {
  useLiveTopics('integrations', [liveTopics.integrations])
  return useFetch('/api/integrations', { key: 'integrations', default: () => [] })
}
