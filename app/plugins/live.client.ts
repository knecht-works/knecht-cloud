export default defineNuxtPlugin(() => {
  const { loggedIn } = useUserSession()
  let source: EventSource | undefined
  let opened = false

  function connect() {
    source = new EventSource('/api/live')
    // EventSource reconnects by itself; changes missed while it was down are refetched.
    source.addEventListener('open', () => {
      if (opened) void invalidateAll().catch(() => {})
      opened = true
    })
    source.addEventListener('topics', e => void invalidate(...JSON.parse(e.data)).catch(() => {}))
  }

  watch(loggedIn, (yes) => {
    if (yes && !source) connect()
    if (!yes) {
      source?.close()
      source = undefined
      opened = false
    }
  }, { immediate: true })
})
