import type { MaybeRefOrGetter } from 'vue'
import { ref, computed, toValue, watch } from 'vue'
import { useEventSource } from '~/composables/useEventSource'

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
