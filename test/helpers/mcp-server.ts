import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

export interface TestMcpServer {
  url: string
  authorizations: string[]
}

export async function withMcpServer(authorization: string | null, fn: (server: TestMcpServer) => Promise<void>): Promise<void> {
  const authorizations: string[] = []
  const http = createServer(async (req, res) => {
    authorizations.push(req.headers.authorization ?? '')
    if (authorization !== null && req.headers.authorization !== authorization) {
      res.statusCode = 401
      return res.end()
    }
    const mcp = new McpServer({ name: 'test', version: '1' })
    mcp.registerTool('echo', { description: 'Echo' }, async () => ({ content: [{ type: 'text', text: 'echo' }] }))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req, res)
  })
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  try {
    await fn({ url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`, authorizations })
  }
  finally {
    http.closeAllConnections()
    await new Promise(resolve => http.close(resolve))
  }
}
