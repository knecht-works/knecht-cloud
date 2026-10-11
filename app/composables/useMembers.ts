import { liveTopics } from '#shared/utils/live-topics'

export function useMembers() {
  useLiveTopics('members', [liveTopics.members])
  return useFetch('/api/members', { key: 'members', default: () => [] })
}
