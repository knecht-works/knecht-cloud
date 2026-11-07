import { liveTopics } from '#shared/utils/live-topics'

// Only owners may list invites, so the page passes whether to load them at all.
export function useInvites(enabled: boolean) {
  useLiveTopics('invites', [liveTopics.invites])
  return useFetch('/api/invites', { key: 'invites', default: () => [], immediate: enabled })
}
