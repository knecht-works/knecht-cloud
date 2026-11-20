import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { mcpCatalogEntry } from '#shared/utils/mcp'
import type { McpServer } from '#server/db/schema'
import { effectiveMcpServers } from '#server/stores/mcp-servers'
import { decrypt } from '#server/utils/crypto'
import { mcpAccessToken } from '#server/utils/mcp-oauth'
import type { OpencodeMcpServer } from '#server/utils/opencode-config'

const PROBE_TIMEOUT_MS = 8000

// opencode substitutes {env:…} into the raw JSON text without escaping.
export const SAFE_HEADER_VALUE_RE = /^[\x20-\x21\x23-\x5B\x5D-\x7E]*$/

export interface ResolvedHeader {
  name: string
  value: string
  secret: boolean
}

export interface McpSetup {
  servers: Record<string, OpencodeMcpServer>
  env: Record<string, string>
  notices: string[]
}

export function mcpServerUrl(row: Pick<McpServer, 'catalogId' | 'url' | 'auth'>): string {
  const entry = mcpCatalogEntry(row.catalogId)
  if (!entry) return row.url!
  return row.auth === 'oauth' ? entry.oauthUrl ?? entry.url : entry.url
}

export async function mcpHeaders(row: McpServer): Promise<ResolvedHeader[]> {
  const headers = row.headers.map(h => h.value === null
    ? { name: h.name, value: decrypt(row.secretsEnc[h.name]!), secret: true }
    : { name: h.name, value: h.value, secret: false })
  const entry = mcpCatalogEntry(row.catalogId)
  if (entry && row.auth === 'token' && row.secretsEnc.token) {
    headers.push({ name: entry.token.header, value: `${entry.token.prefix}${decrypt(row.secretsEnc.token)}`, secret: true })
  }
  if (row.auth === 'oauth') headers.push({ name: 'Authorization', value: `Bearer ${await mcpAccessToken(row)}`, secret: true })
  return headers
}

export async function probeMcpServer(url: string, headers: Record<string, string>): Promise<string[]> {
  try {
    return await listTools(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }))
  }
  catch (streamable) {
    try {
      return await listTools(new SSEClientTransport(new URL(url), { requestInit: { headers } }))
    }
    catch {
      throw streamable
    }
  }
}

async function listTools(transport: Transport): Promise<string[]> {
  const client = new Client({ name: 'knecht', version: '1' })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${PROBE_TIMEOUT_MS / 1000}s`)), PROBE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([
      client.connect(transport).then(() => client.listTools()).then(r => r.tools.map(t => t.name)),
      timeout,
    ])
  }
  finally {
    clearTimeout(timer)
    await client.close().catch(() => {})
  }
}

function envName(serverName: string, index: number): string {
  return `KNECHT_MCP_${serverName.toUpperCase().replace(/-/g, '_')}_${index}`
}

// An unreachable server is left out: opencode would otherwise wait for it on every start.
export async function prepareMcp(projectId: number): Promise<McpSetup> {
  const setup: McpSetup = { servers: {}, env: {}, notices: [] }
  await Promise.all(effectiveMcpServers(projectId).map(async (row) => {
    try {
      const url = mcpServerUrl(row)
      const headers = await mcpHeaders(row)
      if (headers.some(h => !SAFE_HEADER_VALUE_RE.test(h.value))) throw new Error('a header value contains a quote, a backslash or a control character')
      await probeMcpServer(url, Object.fromEntries(headers.map(h => [h.name, h.value])))
      const config: Record<string, string> = {}
      headers.forEach((h, i) => {
        if (!h.secret) {
          config[h.name] = h.value
          return
        }
        const name = envName(row.name, i)
        setup.env[name] = h.value
        config[h.name] = `{env:${name}}`
      })
      setup.servers[row.name] = { type: 'remote', url, headers: config, oauth: false, enabled: true }
    }
    catch (e) {
      setup.notices.push(`The MCP server "${row.name}" is unavailable, so this turn runs without it: ${(e as Error).message}`)
    }
  }))
  return setup
}
