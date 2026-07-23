<script setup lang="ts">
import '@xterm/xterm/css/xterm.css'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

// The web terminal: an xterm view wired to the run's terminal WebSocket
// (server/api/runs/[id]/terminal.ts). Client-only by nature (the parent
// mounts it only inside an open modal). Server frames are raw TTY bytes;
// input and resizes go out as the JSON frames the handler expects. The
// terminal keeps its dark colors regardless of the dashboard theme: it is a
// shell, not a themed surface.
const props = defineProps<{
  runId: number
  service: string
}>()

const host = ref<HTMLDivElement>()
let term: Terminal | undefined
let socket: WebSocket | undefined
let observer: ResizeObserver | undefined

onMounted(() => {
  // The theme background must match the wrapper's, or the padding reads as a
  // frame around the canvas.
  term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 4000, theme: { background: '#1e1e1e' } })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host.value!)
  fit.fit()

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  socket = new WebSocket(
    `${protocol}://${location.host}/api/runs/${props.runId}/terminal`
    + `?service=${encodeURIComponent(props.service)}&cols=${term.cols}&rows=${term.rows}`,
  )
  socket.binaryType = 'arraybuffer'
  socket.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
    term?.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data))
  }
  socket.onclose = () => term?.write('\r\n\x1B[2m[Session ended]\x1B[0m\r\n')

  term.onData((data) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'i', d: data }))
  })

  observer = new ResizeObserver(() => {
    if (!term) return
    fit.fit()
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: 'r', cols: term.cols, rows: term.rows }))
    }
  })
  observer.observe(host.value!)
  term.focus()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  socket?.close()
  term?.dispose()
})
</script>

<template>
  <div
    ref="host"
    class="h-[60vh] rounded-md bg-[#1e1e1e] p-2"
  />
</template>
