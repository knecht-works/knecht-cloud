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

  function schedule() {
    error.value = ''
    state.value = 'saving'
    clearTimeout(timer)
    timer = setTimeout(run, delayMs)
  }

  function invalid(message: string) {
    clearTimeout(timer)
    timer = undefined
    state.value = 'error'
    error.value = message
  }

  function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer)
      return run()
    }
    return chain
  }

  // A pending save goes out as soon as focus leaves a field or the page is
  // about to unload: the debounce window must not swallow the last edit.
  const flushPending = () => {
    if (timer !== undefined) void flush()
  }
  if (import.meta.client) {
    document.addEventListener('focusout', flushPending)
    window.addEventListener('pagehide', flushPending)
  }

  onScopeDispose(() => {
    if (import.meta.client) {
      document.removeEventListener('focusout', flushPending)
      window.removeEventListener('pagehide', flushPending)
    }
    void flush()
  })

  return { state, error, schedule, invalid, flush }
}
