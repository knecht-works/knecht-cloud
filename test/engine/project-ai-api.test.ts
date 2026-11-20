import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'

const access = vi.hoisted(() => ({ owner: true }))
vi.mock('#server/utils/owner', async () => {
  const { createError } = await import('h3')
  return {
    requireOwner: async () => {
      if (!access.owner) throw createError({ statusCode: 403, statusMessage: 'Only an owner can do this.' })
    },
  }
})
vi.mock('#server/utils/ai-catalog', () => ({
  loadModelCatalog: async ({ aiProvider }: { aiProvider: string }) =>
    (aiProvider === 'openai' ? ['gpt-5', 'gpt-5-mini'] : ['claude-opus-5-5', 'claude-sonnet-5']).map(id => ({ id, name: id, provider: aiProvider })),
}))

vi.mock('#server/utils/ai-key', async () => {
  const { createError } = await import('h3')
  return {
    assertAiKeyAccepted: async (_provider: string, _region: string, key: string) => {
      if (key.startsWith('sk-bad')) throw createError({ statusCode: 400, statusMessage: 'Key rejected by Anthropic.' })
    },
  }
})

const patch = (await import('#server/api/projects/[id]/ai.patch')).default
const get = (await import('#server/api/projects/[id]/ai.get')).default
const { getProjectAiSettings } = await import('#server/stores/project-ai-settings')
const { updateSettings } = await import('#server/utils/settings')
const { decrypt, encrypt } = await import('#server/utils/crypto')

updateSettings({ aiProvider: 'anthropic', aiRegion: 'eu', aiKeyEnc: encrypt('sk-global'), aiModel: 'claude-opus-5-5', aiSubtaskModel: null })

const at = (projectId: number) => ({ route: '/:id', path: `/${projectId}` })
const send = (projectId: number, body: object) => callRoute(patch, { method: 'PATCH', ...at(projectId), body })
type View = { overrides: Record<string, unknown> | null, effective: Record<string, unknown> }
const viewOf = (res: { json: unknown }) => res.json as View

describe('PATCH /api/projects/:id/ai', () => {
  it('overrides only the key and inherits the rest', async () => {
    const project = makeProject()
    const res = await send(project.id, { aiKey: 'sk-project-123456' })
    expect(res.status).toBe(200)
    expect(viewOf(res).overrides).toMatchObject({ aiProvider: null, aiModel: null })
    expect(viewOf(res).effective).toEqual({ aiProvider: 'anthropic', aiModel: 'claude-opus-5-5', aiKeyConfigured: true })
    expect(JSON.stringify(res.json)).not.toContain('sk-project-123456')
    expect(decrypt(getProjectAiSettings(project.id)!.aiKeyEnc!)).toBe('sk-project-123456')
    expect(viewOf(await callRoute(get, { method: 'GET', ...at(project.id) })).overrides).toMatchObject({ aiKeyPreview: expect.any(String) })
  })

  it('drops the key and models on a provider switch unless the patch sets them', async () => {
    const project = makeProject()
    await send(project.id, { aiKey: 'sk-project-123456', aiModel: 'claude-sonnet-5' })
    const switched = await send(project.id, { aiProvider: 'openai' })
    expect(viewOf(switched).overrides).toMatchObject({ aiProvider: 'openai', aiRegion: 'eu', aiModel: null })
    expect(viewOf(switched).effective.aiKeyConfigured).toBe(false)
    await send(project.id, { aiProvider: 'openai', aiKey: 'sk-openai-123456' })
    expect((await send(project.id, { aiModel: 'gpt-5' })).status).toBe(200)
    expect(getProjectAiSettings(project.id)).toMatchObject({ aiProvider: 'openai', aiModel: 'gpt-5' })
  })

  it('returns to the global connection once nothing is overridden', async () => {
    const project = makeProject()
    await send(project.id, { aiKey: 'sk-project-123456' })
    expect(viewOf(await send(project.id, { aiKey: null })).overrides).toBeNull()
    expect(getProjectAiSettings(project.id)).toBeUndefined()
  })

  it('keeps a key the provider rejects out', async () => {
    const project = makeProject()
    const res = await send(project.id, { aiProvider: 'openai', aiKey: 'sk-bad-123456' })
    expect(res.status).toBe(400)
    expect(getProjectAiSettings(project.id)).toBeUndefined()
  })

  it('rejects a model the provider does not offer', async () => {
    const project = makeProject()
    expect((await send(project.id, { aiModel: 'gpt-5' })).status).toBe(400)
    expect((await send(project.id, { aiSubtaskModel: 'gpt-5' })).status).toBe(400)
    expect(getProjectAiSettings(project.id)).toBeUndefined()
  })

  it('lets only an owner change the connection', async () => {
    const project = makeProject()
    access.owner = false
    expect((await send(project.id, { aiKey: 'sk-project-123456' })).status).toBe(403)
    access.owner = true
  })
})
