import { describe, expect, it } from 'vitest'
import { makeProject } from '../helpers/db'
import { withMcpServer } from '../helpers/mcp-server'

const { effectiveMcpServers, insertMcpServer } = await import('#server/stores/mcp-servers')
const { mcpHeaders, prepareMcp } = await import('#server/utils/mcp')
const { encrypt } = await import('#server/utils/crypto')
const { db, schema } = await import('#server/db')

function clearMcp() {
  db.delete(schema.mcpServers).run()
}

describe('effectiveMcpServers', () => {
  it('combines global and project servers, a project server replacing the global one of its name', () => {
    clearMcp()
    const project = makeProject()
    const other = makeProject()
    insertMcpServer({ projectId: null, name: 'docs', url: 'https://global.example/mcp' })
    insertMcpServer({ projectId: null, name: 'errors', url: 'https://global-errors.example/mcp' })
    insertMcpServer({ projectId: project.id, name: 'docs', url: 'https://project.example/mcp' })
    insertMcpServer({ projectId: other.id, name: 'other', url: 'https://other.example/mcp' })

    expect(effectiveMcpServers(project.id).map(s => [s.name, s.url])).toEqual([
      ['docs', 'https://project.example/mcp'],
      ['errors', 'https://global-errors.example/mcp'],
    ])
  })

  it('leaves out a global server that a disabled project server of the same name replaces', () => {
    clearMcp()
    const project = makeProject()
    insertMcpServer({ projectId: null, name: 'docs', url: 'https://global.example/mcp' })
    insertMcpServer({ projectId: project.id, name: 'docs', url: 'https://project.example/mcp', enabled: false })

    expect(effectiveMcpServers(project.id)).toEqual([])
    expect(effectiveMcpServers(makeProject().id).map(s => s.name)).toEqual(['docs'])
  })
})

describe('mcpHeaders', () => {
  it('sends a catalog token with the entry\'s own prefix', () => {
    const row = insertMcpServer({ projectId: makeProject().id, name: 'sentry', catalogId: 'sentry', auth: 'token', secretsEnc: { token: encrypt('sntryu_abc') } })
    expect(mcpHeaders(row)).toEqual([{ name: 'Authorization', value: 'Sentry-Bearer sntryu_abc', secret: true }])
  })
})

describe('prepareMcp', () => {
  it('references secret headers through env and keeps plain headers inline', async () => {
    clearMcp()
    const project = makeProject()
    await withMcpServer('Bearer s3cret', async (server) => {
      insertMcpServer({
        projectId: project.id,
        name: 'my-docs',
        url: server.url,
        headers: [{ name: 'Authorization', value: null }, { name: 'X-Team', value: 'web' }],
        secretsEnc: { Authorization: encrypt('Bearer s3cret') },
      })

      const setup = await prepareMcp(project.id)

      expect(setup.notices).toEqual([])
      expect(setup.servers).toEqual({
        'my-docs': {
          type: 'remote',
          url: server.url,
          headers: { 'Authorization': '{env:KNECHT_MCP_MY_DOCS_0}', 'X-Team': 'web' },
          oauth: false,
          enabled: true,
        },
      })
      expect(setup.env).toEqual({ KNECHT_MCP_MY_DOCS_0: 'Bearer s3cret' })
      expect(server.authorizations).toContain('Bearer s3cret')
    })
  })

  it('leaves out a server it cannot reach and says so', async () => {
    clearMcp()
    const project = makeProject()
    await withMcpServer('Bearer right', async (server) => {
      insertMcpServer({
        projectId: project.id,
        name: 'docs',
        url: server.url,
        headers: [{ name: 'Authorization', value: null }],
        secretsEnc: { Authorization: encrypt('Bearer wrong') },
      })

      const setup = await prepareMcp(project.id)

      expect(setup.servers).toEqual({})
      expect(setup.env).toEqual({})
      expect(setup.notices).toEqual([expect.stringContaining('The MCP server "docs" is unavailable')])
    })
  })

  it('refuses a header value that would break the generated config', async () => {
    clearMcp()
    const project = makeProject()
    insertMcpServer({ projectId: project.id, name: 'docs', url: 'https://docs.example/mcp', headers: [{ name: 'X-Key', value: null }], secretsEnc: { 'X-Key': encrypt('a"b') } })

    const setup = await prepareMcp(project.id)

    expect(setup.servers).toEqual({})
    expect(setup.notices).toEqual([expect.stringContaining('quote')])
  })
})
