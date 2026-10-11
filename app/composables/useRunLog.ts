import type { MaybeRefOrGetter } from 'vue'

export function useRunLog(runId: MaybeRefOrGetter<number | null | undefined>) {
  const log = ref('')
  const url = computed(() => {
    const id = toValue(runId)
    return id ? `/api/runs/${id}/log` : null
  })
  watch(url, () => log.value = '')
  useEventSource(url, {
    log: e => log.value += JSON.parse(e.data),
  })
  return log
}
