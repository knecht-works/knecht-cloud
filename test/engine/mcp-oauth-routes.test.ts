import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createRouter, toWebHandler } from 'h3'
import { makeProject } from '../helpers/db'
import { withOAuthMcpServer } from '../helpers/mcp-server'

vi.mock('#server/utils/owner', () => ({ requireOwner: async () => ({ login: 'sam' }) }))

const start = (await import('#server/routes/auth/mcp/[id].get')).default
const callback = (await import('#server/routes/auth/mcp/callback.get')).default
const { getMcpServer, insertMcpServer } = await import('#server/stores/mcp-servers')
const { db, schema } = await import('#server/db')

const router = createRouter().get('/auth/mcp/callback', callback).get('/auth/mcp/:id', start)
const send = toWebHandler(createApp().use(router))
const get = (path: string, cookie?: string) => send(new Request(`https://knecht.example${path}`, { headers: cookie ? { cookie } : {} }))

beforeEach(() => {
  db.delete(schema.mcpServers).run()
})

async function begin(url: string) {
  const project = makeProject()
  const row = insertMcpServer({ projectId: project.id, name: 'docs', url, auth: 'oauth' })
  const res = await get(`/auth/mcp/${row.id}`)
  const cookie = res.headers.getSetCookie()[0]!.split(';')[0]!
  const authorize = new URL(res.headers.get('location')!)
  return { project, row, cookie, authorize }
}

describe('MCP OAuth routes', () => {
  it('connect the server and send the owner back to its settings', async () => {
    await withOAuthMcpServer(async (server) => {
      const { project, row, cookie, authorize } = await begin(server.url)
      expect(authorize.origin).toBe(new URL(server.url).origin)
      expect(authorize.searchParams.get('redirect_uri')).toBe('http://knecht.test/auth/mcp/callback')

      const res = await get(`/auth/mcp/callback?code=the-code&state=${authorize.searchParams.get('state')}`, cookie)

      expect(res.headers.get('location')).toBe(`/projects/${project.id}/settings/agent`)
      expect(getMcpServer(row.id)).toMatchObject({ connectedBy: 'sam', authError: null })
    })
  })

  it('ignore a callback whose state this browser did not start', async () => {
    await withOAuthMcpServer(async (server) => {
      const { row, cookie } = await begin(server.url)

      await get('/auth/mcp/callback?code=the-code&state=planted', cookie)

      expect(server.grants).toEqual([])
      expect(getMcpServer(row.id)!.connectedAt).toBeNull()
    })
  })

  it('keep the reason when the owner declines the sign-in', async () => {
    await withOAuthMcpServer(async (server) => {
      const { row, cookie, authorize } = await begin(server.url)

      await get(`/auth/mcp/callback?error=access_denied&state=${authorize.searchParams.get('state')}`, cookie)

      expect(getMcpServer(row.id)!.authError).toContain('access_denied')
    })
  })
})
