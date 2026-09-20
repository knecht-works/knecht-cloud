import { describe, expect, it, vi } from 'vitest'
import { callRoute, type RouteCall } from '../helpers/routes'

const vendor = vi.hoisted(() => ({ rejects: false }))
const myself = async () => {
  if (vendor.rejects) throw new Error('401')
  return { displayName: 'Knecht', accountId: 'acc-1' }
}
vi.mock('../../server/utils/github-app', () => ({}))
vi.mock('../../server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/jira/api')>(),
  jiraMyself: myself,
  listJiraStatuses: async (key: string) => [`${key} To Do`, `${key} Done`],
}))
vi.mock('../../server/integrations/plane/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/plane/api')>(),
  planeMyself: myself,
}))
vi.mock('../../server/integrations/linear/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/linear/api')>(),
  linearMyself: myself,
}))

const { INTEGRATIONS } = await import('../../server/integrations')
const routes = {
  get: (await import('../../server/api/integrations/[id]/connection.get')).default,
  post: (await import('../../server/api/integrations/[id]/connection.post')).default,
  delete: (await import('../../server/api/integrations/[id]/connection.delete')).default,
  secret: (await import('../../server/api/integrations/[id]/webhook-secret.post')).default,
  options: (await import('../../server/api/integrations/[id]/options/[name].get')).default,
}

const call = (handler: keyof typeof routes, id: string, opts: RouteCall = {}) =>
  callRoute(routes[handler], { route: '/:id', path: `/${id}`, ...opts })

// A value every field type accepts, so the suite needs no per-integration input.
const VALID: Record<string, string> = { url: 'https://acme.example.test/', email: 'knecht@acme.test', text: 'acme', secret: 'token-1234567890abcdef' }

describe.each(INTEGRATIONS.filter(i => i.connection).map(i => [i.id, i] as const))('connection API: %s', (id, integration) => {
  const { form } = integration.connection!
  const body = Object.fromEntries(form.fields.map(f => [f.key, VALID[f.type]!]))
  const secrets = form.fields.filter(f => f.type === 'secret').map(f => f.key)

  it('starts unconnected', async () => {
    const res = await call('get', id, { method: 'GET' })
    expect(res.json).toMatchObject({ configured: false, values: {}, previews: {}, webhookUrl: null, webhookSecret: null })
  })

  it('names the first field that is missing or malformed', async () => {
    const [first] = form.fields
    expect((await call('post', id, { body: { ...body, [first!.key]: '' } })).json).toMatchObject({ statusCode: 400, statusMessage: first!.required })
    const formatted = form.fields.find(f => f.invalid)!
    expect((await call('post', id, { body: { ...body, [formatted.key]: 'not valid!' } })).json).toMatchObject({ statusCode: 400, statusMessage: formatted.invalid })
    expect((await call('get', id, { method: 'GET' })).json).toMatchObject({ configured: false })
  })

  it('reports a connection the tool rejects and stores nothing', async () => {
    vendor.rejects = true
    const res = await call('post', id, { body })
    vendor.rejects = false
    expect(res.json).toMatchObject({ statusCode: 400, statusMessage: form.rejected })
    expect((await call('get', id, { method: 'GET' })).json).toMatchObject({ configured: false })
  })

  it('connects, shows secrets only as previews and keeps the webhook secret across a reconnect', async () => {
    const connected = (await call('post', id, { body })).json as { values: Record<string, string>, previews: Record<string, string>, webhookSecret: string | null }
    expect(connected).toMatchObject({ configured: true, accountName: 'Knecht', accountId: 'acc-1', webhookUrl: expect.stringMatching(new RegExp(`/api/${id}/webhook$`)) })
    expect(Object.keys(connected.values).sort()).toEqual(form.fields.filter(f => f.type !== 'secret').map(f => f.key).sort())
    expect(Object.values(connected.values)).not.toContain('https://acme.example.test/')
    for (const key of secrets) expect(connected.previews[key]).not.toBe(body[key])
    expect(integration.isConfigured()).toBe(form.webhook.secret === 'minted')

    if (form.webhook.secret === 'pasted') {
      expect(connected.webhookSecret).toBeNull()
      expect((await call('secret', id, { body: { webhookSecret: ' ' } })).status).toBe(400)
      expect((await call('secret', id, { body: { webhookSecret: 'whsec' } })).json).toMatchObject({ webhookSecret: 'whsec' })
    }
    else {
      expect(connected.webhookSecret).toMatch(/^[0-9a-f]{64}$/)
      expect((await call('secret', id, { body: { webhookSecret: 'whsec' } })).status).toBe(404)
    }
    expect(integration.isConfigured()).toBe(true)

    const before = ((await call('get', id, { method: 'GET' })).json as { webhookSecret: string }).webhookSecret
    const again = (await call('post', id, { body })).json as { webhookSecret: string }
    expect(again.webhookSecret).toBe(before)
  })

  it('disconnects', async () => {
    expect((await call('delete', id, { method: 'DELETE' })).json).toMatchObject({ configured: false, webhookSecret: null })
    expect(integration.isConfigured()).toBe(false)
  })
})

describe('connection API', () => {
  it('answers 404 for integrations without a connection form', async () => {
    expect((await call('get', 'github', { method: 'GET' })).status).toBe(404)
    expect((await call('get', 'nope', { method: 'GET' })).status).toBe(404)
  })
})

describe('GET /api/integrations/:id/options/:name', () => {
  const options = (id: string, name: string, project?: string) =>
    callRoute(routes.options, { method: 'GET', route: '/:id/:name', path: `/${id}/${name}${project ? `?project=${project}` : ''}` })

  it('serves the option lists an integration declares', async () => {
    expect((await options('jira', 'nope', 'P')).status).toBe(404)
    expect((await options('github', 'statuses', 'P')).status).toBe(404)
    expect((await options('jira', 'statuses', 'P')).json).toMatchObject({ statusCode: 400, statusMessage: 'Jira is not connected' })

    await call('post', 'jira', { body: { siteUrl: 'https://acme.atlassian.net', email: 'k@acme.test', apiToken: 't' } })
    expect((await options('jira', 'statuses')).status).toBe(400)
    expect((await options('jira', 'statuses', 'P')).json).toEqual(['P To Do', 'P Done'])
  })
})
