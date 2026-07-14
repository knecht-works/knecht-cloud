import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

// A throwaway local HTTP server for action tests, so the real fetch code runs
// against real responses. `routes` maps "METHOD /path" to a handler.
export type Route = (req: IncomingMessage, res: ServerResponse, body: string) => void

export async function withServer(routes: Record<string, Route>, fn: (origin: string) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      const route = routes[`${req.method} ${(req.url ?? '').split('?')[0]}`]
      if (!route) {
        res.statusCode = 404
        return res.end('not found')
      }
      route(req, res, body)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  try {
    await fn(origin)
  }
  finally {
    await new Promise(resolve => server.close(resolve))
  }
}
