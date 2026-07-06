// Poll `fn` every `ms` while `active()` is true. The interval keeps ticking
// while inactive (a cheap no-op check), so polling resumes when `active` flips
// back on, e.g. a run started long after mount. Cleans up on unmount.
export function usePollWhile(active: () => boolean, fn: () => void, ms = 1500): void {
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(() => {
      if (active()) fn()
    }, ms)
  })
  onUnmounted(() => timer && clearInterval(timer))
}
