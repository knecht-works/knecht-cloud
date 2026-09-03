// Resume a run from the step that stopped it: completed steps keep their
// results, only the failed step onward re-executes. Shared by the run
// header's Retry button (cancelled runs) and the failed-step banner
// (failed runs): mutually exclusive at runtime, same request either way.
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
