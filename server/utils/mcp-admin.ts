import { z } from 'zod'
import { createError } from 'h3'
import { MCP_AUTH_MODES, MCP_HEADER_NAME_RE, MCP_MAX_HEADERS, MCP_NAME_RE, mcpCatalogEntry, type McpServerView } from '#shared/utils/mcp'
import type { McpHeader, McpServer } from '#server/db/schema'
import { getMcpServer, mcpNameTaken } from '#server/stores/mcp-servers'
import { encrypt } from '#server/utils/crypto'
import { encKeyPreview } from '#server/utils/settings'
import { mcpServerUrl, SAFE_HEADER_VALUE_RE } from '#server/utils/mcp'

const headerValue = z.string().max(4096).regex(SAFE_HEADER_VALUE_RE, 'may not contain quotes, backslashes or control characters')

export const mcpHeaderInput = z.object({
  name: z.string().regex(MCP_HEADER_NAME_RE, 'letters, digits and dashes only'),
  secret: z.boolean(),
  // Left out for a secret header that keeps its stored value.
  value: headerValue.optional(),
})

export const mcpServerInput = z.object({
  name: z.string().regex(MCP_NAME_RE, 'lowercase letters, digits and dashes, starting with a letter'),
  catalogId: z.string().nullable(),
  url: z.string().trim().max(2000).nullable(),
  auth: z.enum(MCP_AUTH_MODES),
  // Left out keeps the stored token, null removes it.
  token: headerValue.trim().nullable().optional(),
  headers: z.array(mcpHeaderInput).max(MCP_MAX_HEADERS),
  enabled: z.boolean(),
})

export type McpServerInput = z.infer<typeof mcpServerInput>

function badRequest(statusMessage: string): never {
  throw createError({ statusCode: 400, statusMessage })
}

function assertHttpUrl(url: string | null): string {
  let parsed: URL
  try {
    parsed = new URL(url ?? '')
  }
  catch {
    badRequest('url: enter the server\'s full URL, for example https://mcp.example.com/mcp')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') badRequest('url: only http and https URLs work')
  return parsed.toString()
}

// Merges the input onto the stored row: a secret left out keeps its stored value.
export function mcpServerValues(projectId: number | null, input: McpServerInput, existing?: McpServer) {
  if (mcpNameTaken(projectId, input.name, existing?.id)) {
    badRequest(`name: ${projectId === null ? 'another global' : 'another'} MCP server is already called ${input.name}`)
  }
  const entry = input.catalogId === null ? undefined : mcpCatalogEntry(input.catalogId)
  if (input.catalogId !== null && !entry) badRequest(`catalogId: ${input.catalogId} is not in the catalog`)

  const secretsEnc: Record<string, string> = {}
  if (entry) {
    if (!entry.auth.includes(input.auth)) badRequest(`auth: ${entry.label} does not support ${input.auth}`)
    if (input.headers.length) badRequest('headers: a catalog server takes no extra headers')
    if (input.auth === 'token') {
      const stored = existing?.catalogId === entry.id && existing.auth === 'token' ? existing.secretsEnc.token : undefined
      const token = input.token ? encrypt(input.token) : input.token === null ? undefined : stored
      if (!token && !entry.auth.includes('none')) badRequest(`token: ${entry.label} needs its ${entry.token.label.toLowerCase()}`)
      if (token) secretsEnc.token = token
    }
  }
  else if (input.auth === 'token') {
    badRequest('auth: a custom server sends its token as a header')
  }

  const headers: McpHeader[] = []
  const seen = new Set<string>()
  for (const h of input.headers) {
    const key = h.name.toLowerCase()
    if (seen.has(key)) badRequest(`headers: ${h.name} is set twice`)
    seen.add(key)
    if (!h.secret) {
      headers.push({ name: h.name, value: h.value ?? '' })
      continue
    }
    const stored = existing?.headers.some(old => old.name === h.name && old.value === null) ? existing.secretsEnc[h.name] : undefined
    const value = h.value ? encrypt(h.value) : stored
    if (!value) badRequest(`headers: ${h.name} needs a value`)
    headers.push({ name: h.name, value: null })
    secretsEnc[h.name] = value
  }

  return {
    name: input.name,
    catalogId: entry?.id ?? null,
    url: entry ? null : assertHttpUrl(input.url),
    auth: input.auth,
    headers,
    secretsEnc,
    enabled: input.enabled,
  }
}

export function mcpServerView(row: McpServer): McpServerView {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    catalogId: row.catalogId,
    url: mcpServerUrl(row),
    auth: row.auth,
    enabled: row.enabled,
    headers: row.headers.map(h => ({
      name: h.name,
      secret: h.value === null,
      value: h.value,
      preview: h.value === null ? encKeyPreview(row.secretsEnc[h.name]!) ?? null : null,
    })),
    tokenPreview: row.secretsEnc.token ? encKeyPreview(row.secretsEnc.token) ?? null : null,
    oauth: {
      connected: !!row.connectedAt,
      manualClient: false,
      connectedBy: row.connectedBy,
      connectedAt: row.connectedAt?.toISOString() ?? null,
      error: row.authError,
    },
  }
}

export function requireMcpServer(id: number): McpServer {
  const row = getMcpServer(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'MCP server not found' })
  return row
}
