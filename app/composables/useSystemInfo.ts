export function useSystemInfo() {
  return useFetch('/api/system', { key: 'system', lazy: true })
}
