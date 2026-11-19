import { liveTopics } from '#shared/utils/live-topics'
import { useLiveTopics } from '~/composables/useLiveTopics'
import { useFetch } from '#app'

// Only owners may list invites, so the page passes whether to load them at all.
export function useInvites(enabled: boolean) {
  useLiveTopics('invites', [liveTopics.invites])
  return useFetch('/api/invites', { key: 'invites', default: () => [], immediate: enabled })
}
