import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'

const access = vi.hoisted(() => ({ owner: true }))
vi.mock('#server/utils/owner', async () => {
  const { createError } = await import('h3')
  return {
    requireOwner: async () => {
      if (!access.owner) throw createError({ statusCode: 403, statusMessage: 'Only an owner can do this.' })
    },
  }
})

vi.mock('#server/utils/ai-key', () => ({ assertAiKeyAccepted: async () => {} }))

const { getSettings, updateSettings } = await import('#server/utils/settings')
const patch = (await import('#server/api/settings.patch')).default
const send = (body: object) => callRoute(patch, { method: 'PATCH', body })

describe('PATCH /api/settings', () => {
  it('lets only an owner change the provider connection and instance settings', async () => {
    const changes = [
      { aiProvider: 'anthropic' }, { aiRegion: 'eu' }, { aiKey: 'sk-new' }, { aiModel: 'claude-opus-5-5' }, { aiSubtaskModel: null },
      { idleStopMinutes: 10 }, { previewRetentionDays: 1 }, { archiveRetentionDays: 1 }, { maxConcurrentRuns: 1 },
      { previewAccess: 'public' }, { shareLinkHours: 1 },
      { sshTarget: 'knecht@example.com' }, { autoUpdateCron: '0 3 * * *' },
    ]
    access.owner = false
    for (const body of changes) expect((await send(body)).status).toBe(403)
    access.owner = true
  })

  it('lets any member change the agent instructions', async () => {
    access.owner = false
    const res = await send({ agentInstructions: 'Answer in German.' })
    access.owner = true
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ agentInstructions: 'Answer in German.' })
  })

  it('drops the key and models on a provider switch unless the patch brings a key', async () => {
    updateSettings({ aiProvider: 'opencode', aiKeyEnc: 'old-key', aiModel: 'claude-opus-5-5', aiSubtaskModel: 'claude-sonnet-5' })
    expect((await send({ aiProvider: 'anthropic' })).status).toBe(200)
    expect(getSettings()).toMatchObject({ aiProvider: 'anthropic', aiKeyEnc: null, aiModel: null, aiSubtaskModel: null })
    expect((await send({ aiProvider: 'openai', aiKey: 'sk-new' })).json).toMatchObject({ aiProvider: 'openai', aiKeyConfigured: true })
  })
})
