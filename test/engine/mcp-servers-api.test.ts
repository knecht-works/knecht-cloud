import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'
import { withMcpServer } from '../helpers/mcp-server'

const access = vi.hoisted(() => ({ owner: true }))
vi.mock('#server/utils/owner', async () => {
  const { createError } = await import('h3')
  return {
    requireOwner: async () => {
      if (!access.owner) throw createError({ statusCode: 403, statusMessage: 'Only an owner can do this.' })
    },
  }
})

const list = (await import('#server/api/mcp-servers/index.get')).default
const create = (await import('#server/api/mcp-servers/index.post')).default
const patch = (await import('#server/api/mcp-servers/[id].patch')).default
const remove = (await import('#server/api/mcp-servers/[id].delete')).default
const test = (await import('#server/api/mcp-servers/[id]/test.post')).default
const { getMcpServer } = await import('#server/stores/mcp-servers')
const { decrypt } = await import('#server/utils/crypto')
const { encryptOAuthState, readOAuthState } = await import('#server/utils/mcp-oauth')
const { updateMcpServer } = await import('#server/stores/mcp-servers')
const { db, schema } = await import('#server/db')

type View = { id: number, name: string, url: string, tokenPreview: string | null, headers: { name: string, secret: boolean, value: string | null, preview: string | null }[] }

const base = { catalogId: null, url: null, auth: 'none', headers: [], enabled: true }
const post = (body: object) => callRoute(create, { method: 'POST', body: { projectId: null, ...base, ...body } })
const update = (id: number, body: object) => callRoute(patch, { method: 'PATCH', route: '/:id', path: `/${id}`, body: { ...base, ...body } })

beforeEach(() => {
  access.owner = true
  db.delete(schema.mcpServers).run()
})

describe('MCP server API', () => {
  it('stores a catalog token encrypted and never returns it', async () => {
    const res = await post({ name: 'sentry', catalogId: 'sentry', auth: 'token', token: 'sntryu_secret_123456' })
    expect(res.status).toBe(200)
    const view = res.json as View
    expect(view.url).toBe('https://mcp.sentry.dev/mcp')
    expect(view.tokenPreview).toEqual(expect.any(String))
    expect(res.text).not.toContain('sntryu_secret_123456')
    expect(decrypt(getMcpServer(view.id)!.secretsEnc.token!)).toBe('sntryu_secret_123456')
  })

  it('keeps a stored token and secret header when an edit leaves them out', async () => {
    const custom = (await post({ name: 'docs', url: 'https://docs.example/mcp', headers: [{ name: 'X-Key', secret: true, value: 'k-123' }, { name: 'X-Team', secret: false, value: 'web' }] })).json as View
    const edited = await update(custom.id, { name: 'docs', url: 'https://docs.example/v2/mcp', headers: [{ name: 'X-Key', secret: true }, { name: 'X-Team', secret: false, value: 'shop' }] })
    expect(edited.status).toBe(200)
    const row = getMcpServer(custom.id)!
    expect(row.headers).toEqual([{ name: 'X-Key', value: null }, { name: 'X-Team', value: 'shop' }])
    expect(decrypt(row.secretsEnc['X-Key']!)).toBe('k-123')

    const sentry = (await post({ name: 'sentry', catalogId: 'sentry', auth: 'token', token: 'sntryu_secret_123456' })).json as View
    await update(sentry.id, { name: 'sentry', catalogId: 'sentry', auth: 'token', enabled: false })
    expect(decrypt(getMcpServer(sentry.id)!.secretsEnc.token!)).toBe('sntryu_secret_123456')
  })

  it('rejects what would break the server or the generated config', async () => {
    expect((await post({ name: 'Docs', url: 'https://docs.example/mcp' })).status).toBe(400)
    expect((await post({ name: 'docs', url: 'ftp://docs.example' })).status).toBe(400)
    expect((await post({ name: 'docs', url: 'https://docs.example/mcp', headers: [{ name: 'X-Key', secret: true, value: 'a"b' }] })).status).toBe(400)
    expect((await post({ name: 'docs', url: 'https://docs.example/mcp', headers: [{ name: 'X-Key', secret: true }] })).status).toBe(400)
    expect((await post({ name: 'sentry', catalogId: 'sentry', auth: 'token' })).status).toBe(400)
    expect((await post({ name: 'sentry', catalogId: 'sentry', auth: 'none' })).status).toBe(400)
    expect((await post({ name: 'context7', catalogId: 'context7', auth: 'none' })).status).toBe(200)
  })

  it('allows one name per level, also when a project reuses a global name', async () => {
    const project = makeProject()
    expect((await post({ name: 'docs', url: 'https://a.example/mcp' })).status).toBe(200)
    expect((await post({ name: 'docs', url: 'https://b.example/mcp' })).status).toBe(400)
    expect((await post({ projectId: project.id, name: 'docs', url: 'https://c.example/mcp' })).status).toBe(200)

    const res = await callRoute(list, { method: 'GET', path: `/?projectId=${project.id}` })
    const body = res.json as { servers: View[], global: View[] }
    expect(body.servers.map(s => s.url)).toEqual(['https://c.example/mcp'])
    expect(body.global.map(s => s.url)).toEqual(['https://a.example/mcp'])
  })

  it('lets only an owner change servers', async () => {
    const view = (await post({ name: 'docs', url: 'https://a.example/mcp' })).json as View
    access.owner = false
    expect((await post({ name: 'more', url: 'https://b.example/mcp' })).status).toBe(403)
    expect((await callRoute(remove, { method: 'DELETE', route: '/:id', path: `/${view.id}` })).status).toBe(403)
    expect(getMcpServer(view.id)).toBeDefined()
  })

  it('keeps an OAuth connection only while the server stays the same', async () => {
    const view = (await post({ name: 'docs', url: 'https://a.example/mcp', auth: 'oauth' })).json as View
    const connect = () => updateMcpServer(view.id, { oauthEnc: encryptOAuthState({ tokens: { access_token: 'at', token_type: 'Bearer' } }), connectedBy: 'sam', connectedAt: new Date() })

    connect()
    await update(view.id, { name: 'docs', url: 'https://a.example/mcp', auth: 'oauth', enabled: false })
    expect(getMcpServer(view.id)!.connectedBy).toBe('sam')

    await update(view.id, { name: 'docs', url: 'https://b.example/mcp', auth: 'oauth' })
    expect(getMcpServer(view.id)).toMatchObject({ oauthEnc: null, connectedAt: null })

    connect()
    await update(view.id, { name: 'docs', url: 'https://b.example/mcp', auth: 'none' })
    expect(getMcpServer(view.id)).toMatchObject({ oauthEnc: null, connectedAt: null })
  })

  it('stores a manual OAuth client encrypted', async () => {
    const res = await post({ name: 'docs', url: 'https://a.example/mcp', auth: 'oauth', oauthClient: { id: 'knecht', secret: 'client-s3cret' } })
    expect(res.json).toMatchObject({ oauth: { manualClient: true, connected: false } })
    expect(res.text).not.toContain('client-s3cret')
    const row = getMcpServer((res.json as View).id)!
    expect(readOAuthState(row).client).toEqual({ client_id: 'knecht', client_secret: 'client-s3cret' })

    await update(row.id, { name: 'docs', url: 'https://a.example/mcp', auth: 'oauth', oauthClient: null })
    expect(getMcpServer(row.id)!.oauthEnc).toBeNull()
  })

  it('lists the tools of a reachable server and explains an unreachable one', async () => {
    await withMcpServer('Bearer s3cret', async (server) => {
      const ok = (await post({ name: 'good', url: server.url, headers: [{ name: 'Authorization', secret: true, value: 'Bearer s3cret' }] })).json as View
      const bad = (await post({ name: 'bad', url: server.url })).json as View
      const tools = await callRoute(test, { method: 'POST', route: '/:id/test', path: `/${ok.id}/test` })
      expect(tools.json).toEqual({ tools: ['echo'] })
      const failed = await callRoute(test, { method: 'POST', route: '/:id/test', path: `/${bad.id}/test` })
      expect(failed.status).toBe(502)
    })
  })
})
