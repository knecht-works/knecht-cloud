const open = ref(false)
let settle: ((confirmed: boolean) => void) | null = null

export function isReauthError(e: unknown): boolean {
  return (e as { data?: { data?: { reauth?: boolean } } }).data?.data?.reauth === true
}

// Runs a sensitive request; when the server asks for a fresh confirmation,
// shows the "Confirm it's you" dialog (KReauthModal) and retries once.
export function useElevation() {
  function confirm(): Promise<boolean> {
    settle?.(false)
    open.value = true
    return new Promise((resolve) => {
      settle = resolve
    })
  }

  function finish(confirmed: boolean) {
    open.value = false
    settle?.(confirmed)
    settle = null
  }

  async function withElevation<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request()
    }
    catch (e) {
      if (!isReauthError(e) || !await confirm()) throw e
      return await request()
    }
  }

  return { open, finish, withElevation }
}
