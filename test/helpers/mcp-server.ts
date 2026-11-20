import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

export interface TestMcpServer {
  url: string
  authorizations: string[]
}

async function serveMcp(req: IncomingMessage, res: ServerResponse) {
  const mcp = new McpServer({ name: 'test', version: '1' })
  mcp.registerTool('echo', { description: 'Echo' }, async () => ({ content: [{ type: 'text', text: 'echo' }] }))
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    void transport.close()
    void mcp.close()
  })
  await mcp.connect(transport)
  await transport.handleRequest(req, res)
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse, origin: string) => Promise<unknown>, fn: (origin: string) => Promise<void>) {
  let origin = ''
  const http = createServer((req, res) => void handler(req, res, origin))
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  try {
    await fn(origin)
  }
  finally {
    http.closeAllConnections()
    await new Promise(resolve => http.close(resolve))
  }
}

export async function withMcpServer(authorization: string | null, fn: (server: TestMcpServer) => Promise<void>): Promise<void> {
  const authorizations: string[] = []
  await listen(async (req, res) => {
    authorizations.push(req.headers.authorization ?? '')
    if (authorization !== null && req.headers.authorization !== authorization) {
      res.statusCode = 401
      return res.end()
    }
    await serveMcp(req, res)
  }, origin => fn({ url: `${origin}/mcp`, authorizations }))
}

export interface TestOAuthMcpServer extends TestMcpServer {
  // Seconds until an access token expires, as the token endpoint reports it.
  expiresIn: number
  refreshWorks: boolean
  grants: string[]
  registrations: number
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = ''
  for await (const chunk of req) body += chunk
  return new URLSearchParams(body)
}

function json(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// Authorization server and MCP resource in one: the code is always "the-code".
export async function withOAuthMcpServer(fn: (server: TestOAuthMcpServer) => Promise<void>): Promise<void> {
  const server: TestOAuthMcpServer = { url: '', authorizations: [], expiresIn: 3600, refreshWorks: true, grants: [], registrations: 0 }
  let issued = 0
  const valid = new Set<string>()
  await listen(async (req, res, origin) => {
    const path = (req.url ?? '').split('?')[0]
    if (path?.startsWith('/.well-known/oauth-protected-resource')) {
      return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] })
    }
    if (path === '/.well-known/oauth-authorization-server') {
      return json(res, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (path === '/register') {
      server.registrations++
      let body = ''
      for await (const chunk of req) body += chunk
      return json(res, 201, { ...JSON.parse(body), client_id: `client-${server.registrations}` })
    }
    if (path === '/token') {
      const form = await readForm(req)
      const grant = form.get('grant_type')!
      server.grants.push(grant)
      if (grant === 'authorization_code' && form.get('code') !== 'the-code') return json(res, 400, { error: 'invalid_grant' })
      if (grant === 'refresh_token' && !server.refreshWorks) return json(res, 400, { error: 'invalid_grant' })
      const accessToken = `at-${++issued}`
      valid.add(accessToken)
      return json(res, 200, { access_token: accessToken, refresh_token: `rt-${issued}`, token_type: 'Bearer', expires_in: server.expiresIn })
    }
    server.authorizations.push(req.headers.authorization ?? '')
    if (!valid.has((req.headers.authorization ?? '').replace(/^Bearer /, ''))) {
      res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` })
      return res.end()
    }
    await serveMcp(req, res)
  }, (origin) => {
    server.url = `${origin}/mcp`
    return fn(server)
  })
}
