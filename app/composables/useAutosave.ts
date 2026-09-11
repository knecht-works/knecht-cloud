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

  onScopeDispose(() => {
    void flush()
  })

  return { state, error, schedule, invalid, flush }
}
