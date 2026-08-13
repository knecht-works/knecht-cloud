// Shared autosave plumbing: ONE debounced save with a KSaveStatus-compatible
// state, an invalid() short-circuit for client-side validation, and a flush on
// unmount so an edit still inside the debounce window isn't silently dropped
// by navigating away. The page keeps its own field watcher (dirty check +
// validation) and calls schedule()/invalid(). flush() persists a pending edit
// immediately, for actions that need the server to have the latest state.
export function useAutosave(save: () => Promise<void>, delayMs = 800) {
  const state = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const error = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  // Saves are chained: a schedule() firing while a request is in flight waits
  // for it instead of racing it, so PATCHes can't persist out of order.
  let chain: Promise<void> = Promise.resolve()

  function run(): Promise<void> {
    timer = undefined
    chain = chain.then(async () => {
      try {
        await save()
        state.value = 'saved'
      }
      catch (e) {
        state.value = 'error'
        error.value = errMsg(e, 'Not saved')
      }
    })
    return chain
  }

  // Debounced so a keystroke doesn't fire a request.
  function schedule() {
    error.value = ''
    state.value = 'saving'
    clearTimeout(timer)
    timer = setTimeout(run, delayMs)
  }

  // Validation failed at the field: show the reason and send nothing. Also
  // drops an already-scheduled save, which would read the now-invalid values.
  function invalid(message: string) {
    clearTimeout(timer)
    timer = undefined
    state.value = 'error'
    error.value = message
  }

  // Persist a still-debouncing edit NOW (or await the in-flight save).
  function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer)
      return run()
    }
    return chain
  }

  onScopeDispose(() => {
    void flush()
  })

  return { state, error, schedule, invalid, flush }
}
