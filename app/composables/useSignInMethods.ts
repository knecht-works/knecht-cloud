import { liveTopics } from '#shared/utils/live-topics'

export function useSignInMethods() {
  useLiveTopics('me:sign-in', [liveTopics.members])
  return useFetch('/api/me/sign-in', { key: 'me:sign-in' })
}
