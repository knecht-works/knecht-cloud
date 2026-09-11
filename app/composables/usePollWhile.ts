// Keeps ticking while inactive: polling must resume when `active` flips back on.
export function usePollWhile(active: () => boolean, fn: () => void, ms = 1500): void {
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(() => {
      if (active()) fn()
    }, ms)
  })
  onUnmounted(() => timer && clearInterval(timer))
}
