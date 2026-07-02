// Poll `fn` every `ms` while `active()` is true; stops itself on unmount.
export function usePollWhile(active: () => boolean, fn: () => void, ms = 1500): void {
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(() => {
      if (active()) fn()
      else if (timer) clearInterval(timer)
    }, ms)
  })
  onUnmounted(() => timer && clearInterval(timer))
}
