import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as h3 from 'h3'
import { createApp, createRouter, toNodeListener, type EventHandler } from 'h3'
import * as entities from '../../server/utils/entities'
import * as http from '../../server/utils/http'

// Nitro auto-imports h3 and server/utils into route modules; the engine tests
// import the route modules directly, so the same names must exist as globals.
Object.assign(globalThis, h3, entities, http)

export interface RouteResponse {
  status: number
  text: string
  json: unknown
}

export interface RouteCall {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  route?: string
  path?: string
  body?: string | object
  headers?: Record<string, string>
}

export async function callRoute(handler: EventHandler, opts: RouteCall = {}): Promise<RouteResponse> {
  const router = createRouter()
  router.use(opts.route ?? '/', handler)
  const app = createApp().use(router)
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    const body = opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
    const res = await fetch(`http://127.0.0.1:${port}${opts.path ?? '/'}`, {
      method: opts.method ?? 'POST',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      body,
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    }
    catch {
      // Plain-text response.
    }
    return { status: res.status, text, json }
  }
  finally {
    server.close()
  }
}
