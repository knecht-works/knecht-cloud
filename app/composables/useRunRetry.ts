import { useToastError } from '~/composables/useToastError'
import { ref } from 'vue'
import { $fetch } from '#imports'

export function useRunRetry(runId: number, onDone: () => void) {
  const toastError = useToastError()
  const retrying = ref(false)
  async function retry() {
    retrying.value = true
    try {
      await $fetch(`/api/runs/${runId}/retry`, { method: 'POST' })
      onDone()
    }
    catch (e) {
      toastError('Retry failed', e)
    }
    finally {
      retrying.value = false
    }
  }
  return { retrying, retry }
}
