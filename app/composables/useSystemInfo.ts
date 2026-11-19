import { useFetch } from '#imports'

export function useSystemInfo() {
  return useFetch('/api/system', { key: 'system', lazy: true })
}
