import { wrapWebsocketResolve } from '../utils/ide-proxy'

// Wire the web IDE's WebSocket leg into h3's upgrade routing (see
// utils/ide-proxy.ts for why this can't be a normal ws route).
export default defineNitroPlugin((nitroApp) => {
  try {
    wrapWebsocketResolve(nitroApp.h3App as unknown as Parameters<typeof wrapWebsocketResolve>[0])
  }
  catch (e) {
    console.error('IDE websocket wiring failed:', (e as Error).message)
  }
})
