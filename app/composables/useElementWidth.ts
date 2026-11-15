export function useElementWidth(el: Ref<HTMLElement | undefined>) {
  const width = ref<number | null>(null)
  let observer: ResizeObserver | undefined
  onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
      width.value = entry!.contentRect.width
    })
    if (el.value) observer.observe(el.value)
  })
  onBeforeUnmount(() => observer?.disconnect())
  return width
}
