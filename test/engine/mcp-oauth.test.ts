import { beforeEach, describe, expect, it } from 'vitest'
import { makeProject } from '../helpers/db'
import { withOAuthMcpServer } from '../helpers/mcp-server'

const { getMcpServer, insertMcpServer } = await import('#server/stores/mcp-servers')
const { finishMcpOAuth, readOAuthState, startMcpOAuth } = await import('#server/utils/mcp-oauth')
const { prepareMcp } = await import('#server/utils/mcp')
const { db, schema } = await import('#server/db')

const REDIRECT = 'https://knecht.example/auth/mcp/callback'

beforeEach(() => {
  db.delete(schema.mcpServers).run()
})

async function connect(url: string) {
  const project = makeProject()
  const row = insertMcpServer({ projectId: project.id, name: 'docs', url, auth: 'oauth' })
  const authorize = await startMcpOAuth(row, REDIRECT, 'flow-state')
  await finishMcpOAuth(getMcpServer(row.id)!, 'the-code', 'sam')
  return { project, row: getMcpServer(row.id)!, authorize }
}

describe('MCP OAuth', () => {
  it('registers Knecht, sends the browser to the server\'s sign-in and stores the tokens encrypted', async () => {
    await withOAuthMcpServer(async (server) => {
      const { row, authorize } = await connect(server.url)

      expect(authorize.searchParams.get('client_id')).toBe('client-1')
      expect(authorize.searchParams.get('state')).toBe('flow-state')
      expect(authorize.searchParams.get('redirect_uri')).toBe(REDIRECT)
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
      expect(row.connectedBy).toBe('sam')
      expect(row.connectedAt).toBeInstanceOf(Date)
      expect(row.oauthEnc).not.toContain('at-1')
      expect(readOAuthState(row).tokens?.access_token).toBe('at-1')
      expect(readOAuthState(row).verifier).toBeUndefined()
    })
  })

  it('hands the agent the access token through env', async () => {
    await withOAuthMcpServer(async (server) => {
      const { project } = await connect(server.url)

      const setup = await prepareMcp(project.id)

      expect(setup.notices).toEqual([])
      expect(setup.servers.docs?.headers).toEqual({ Authorization: '{env:KNECHT_MCP_DOCS_0}' })
      expect(setup.env).toEqual({ KNECHT_MCP_DOCS_0: 'Bearer at-1' })
    })
  })

  it('refreshes an expiring token once, even for parallel starts', async () => {
    await withOAuthMcpServer(async (server) => {
      server.expiresIn = 30
      const { project } = await connect(server.url)

      const [a, b] = await Promise.all([prepareMcp(project.id), prepareMcp(project.id)])

      expect(server.grants).toEqual(['authorization_code', 'refresh_token'])
      expect(a.env.KNECHT_MCP_DOCS_0).toBe('Bearer at-2')
      expect(b.env.KNECHT_MCP_DOCS_0).toBe('Bearer at-2')
    })
  })

  it('leaves the server out and asks to reconnect when the refresh fails', async () => {
    await withOAuthMcpServer(async (server) => {
      server.expiresIn = 30
      const { project, row } = await connect(server.url)
      server.refreshWorks = false

      const setup = await prepareMcp(project.id)

      expect(setup.servers).toEqual({})
      expect(setup.notices).toEqual([expect.stringContaining('The MCP server "docs" is unavailable')])
      expect(getMcpServer(row.id)!.authError).toEqual(expect.any(String))
    })
  })

  it('reuses the registered client when connecting again', async () => {
    await withOAuthMcpServer(async (server) => {
      const { row } = await connect(server.url)
      const again = await startMcpOAuth(row, REDIRECT, 'second')

      expect(again.searchParams.get('client_id')).toBe('client-1')
      expect(server.registrations).toBe(1)
    })
  })

  it('keeps the working connection while a reconnect is not finished', async () => {
    await withOAuthMcpServer(async (server) => {
      const { project, row } = await connect(server.url)
      await startMcpOAuth(row, REDIRECT, 'second')

      const setup = await prepareMcp(project.id)

      expect(setup.notices).toEqual([])
      expect(setup.env).toEqual({ KNECHT_MCP_DOCS_0: 'Bearer at-1' })
    })
  })

  it('says so when a server is not connected yet', async () => {
    const project = makeProject()
    insertMcpServer({ projectId: project.id, name: 'docs', url: 'https://docs.example/mcp', auth: 'oauth' })

    const setup = await prepareMcp(project.id)

    expect(setup.notices).toEqual([expect.stringContaining('not connected yet')])
  })
})
