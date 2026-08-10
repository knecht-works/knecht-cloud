// Shared autosave plumbing for the settings pages: ONE debounced save with a
// KSaveStatus-compatible state, an invalid() short-circuit for client-side
// validation, and a flush on unmount so an edit still inside the debounce
// window isn't silently dropped by navigating away. The page keeps its own
// field watcher (dirty check + validation) and calls schedule()/invalid().
export function useAutosave(save: () => Promise<void>, delayMs = 800) {
  const state = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const error = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined

  async function run() {
    timer = undefined
    try {
      await save()
      state.value = 'saved'
    }
    catch (e) {
      state.value = 'error'
      error.value = errMsg(e, 'Not saved')
    }
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

  onScopeDispose(() => {
    if (timer !== undefined) {
      clearTimeout(timer)
      void run()
    }
  })

  return { state, error, schedule, invalid }
}
