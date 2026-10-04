export function useResizableHeight(min: number) {
  const el = ref<HTMLElement | null>(null)
  const height = ref<number | null>(null)
  const resizing = ref(false)

  function startResize(e: PointerEvent) {
    const startY = e.clientY
    const startHeight = el.value!.offsetHeight
    resizing.value = true
    const move = (ev: PointerEvent) => {
      height.value = Math.max(min, startHeight + ev.clientY - startY)
    }
    const stop = () => {
      resizing.value = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  return { el, height, resizing, startResize }
}
