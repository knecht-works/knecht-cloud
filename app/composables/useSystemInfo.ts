// Host/sandbox probe, shared (one keyed fetch) between the sidebar's system
// card and the System page. Lazy: /api/system spawns docker probes; consumers
// stream in after paint.
export function useSystemInfo() {
  return useFetch('/api/system', { key: 'system', lazy: true })
}
