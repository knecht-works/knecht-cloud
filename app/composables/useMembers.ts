import { liveTopics } from '#shared/utils/live-topics'
import { useLiveTopics } from '~/composables/useLiveTopics'
import { useFetch } from '#imports'

export function useMembers() {
  useLiveTopics('members', [liveTopics.members])
  return useFetch('/api/members', { key: 'members', default: () => [] })
}
