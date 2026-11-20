export const MCP_AUTH_MODES = ['none', 'token', 'oauth'] as const
export type McpAuthMode = typeof MCP_AUTH_MODES[number]

export const MCP_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/
export const MCP_HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/
export const MCP_MAX_HEADERS = 10

export interface McpCatalogToken {
  label: string
  placeholder: string
  hint: string
  header: string
  prefix: string
}

export interface McpCatalogEntry {
  id: string
  label: string
  description: string
  docsUrl: string
  url: string
  // Context7 serves its OAuth flow under its own path.
  oauthUrl?: string
  auth: readonly McpAuthMode[]
  token: McpCatalogToken
}

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  {
    id: 'sentry',
    label: 'Sentry',
    description: 'Issues, stack traces, traces and releases from sentry.io.',
    docsUrl: 'https://mcp.sentry.dev',
    url: 'https://mcp.sentry.dev/mcp',
    auth: ['oauth', 'token'],
    token: {
      label: 'User auth token',
      placeholder: 'sntryu_…',
      hint: 'A user auth token with the scopes org:read, project:read, project:write, team:read, team:write and event:write.',
      // Sentry reserves "Bearer" for its own OAuth tokens.
      header: 'Authorization',
      prefix: 'Sentry-Bearer ',
    },
  },
  {
    id: 'context7',
    label: 'Context7',
    description: 'Current documentation and code examples for libraries and frameworks.',
    docsUrl: 'https://context7.com/docs',
    url: 'https://mcp.context7.com/mcp',
    oauthUrl: 'https://mcp.context7.com/mcp/oauth',
    auth: ['none', 'token', 'oauth'],
    token: {
      label: 'API key',
      placeholder: 'ctx7sk-…',
      hint: 'Optional. Without a key Context7 applies lower rate limits.',
      header: 'Authorization',
      prefix: 'Bearer ',
    },
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Pages and databases of a Notion workspace.',
    docsUrl: 'https://developers.notion.com/docs/mcp',
    url: 'https://mcp.notion.com/mcp',
    auth: ['oauth', 'token'],
    token: {
      label: 'MCP token',
      placeholder: 'ntn_…',
      hint: 'Created by a workspace owner under New MCP token in the Notion developer portal. Business and Enterprise plans only.',
      header: 'Authorization',
      prefix: 'Bearer ',
    },
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    description: 'The whole Cloudflare API: DNS, Workers, R2, caching and its documentation.',
    docsUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/',
    url: 'https://mcp.cloudflare.com/mcp',
    auth: ['oauth', 'token'],
    token: {
      label: 'API token',
      placeholder: 'Cloudflare API token',
      hint: 'A user or account API token with the permissions the agent may use.',
      header: 'Authorization',
      prefix: 'Bearer ',
    },
  },
]

export function mcpCatalogEntry(id: string | null | undefined): McpCatalogEntry | undefined {
  return MCP_CATALOG.find(e => e.id === id)
}

export interface McpHeaderView {
  name: string
  secret: boolean
  value: string | null
  preview: string | null
}

export interface McpServerView {
  id: number
  projectId: number | null
  name: string
  catalogId: string | null
  url: string
  auth: McpAuthMode
  enabled: boolean
  headers: McpHeaderView[]
  tokenPreview: string | null
  oauth: {
    connected: boolean
    manualClient: boolean
    connectedBy: string | null
    connectedAt: string | null
    error: string | null
  }
}
