import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'

const access = vi.hoisted(() => ({ owner: true, elevated: true }))
vi.mock('../../server/utils/owner', async () => {
  const { createError } = await import('h3')
  return {
    requireOwner: async () => {
      if (!access.owner) throw createError({ statusCode: 403, statusMessage: 'Only an owner can do this.' })
    },
  }
})
vi.mock('../../server/utils/member-session', async () => {
  const { createError } = await import('h3')
  return {
    requireElevated: async () => {
      if (!access.elevated) throw createError({ statusCode: 403, statusMessage: 'Confirm it’s you to continue.', data: { reauth: true } })
    },
  }
})

const patch = (await import('../../server/api/settings.patch')).default
const send = (body: object) => callRoute(patch, { method: 'PATCH', body })

describe('PATCH /api/settings', () => {
  it('lets only an owner with a confirmed session change the provider connection and instance settings', async () => {
    const changes = [
      { aiProvider: 'anthropic' }, { aiRegion: 'eu' }, { aiKey: 'sk-new' }, { aiModel: 'claude-opus-5-5' }, { aiSubtaskModel: null },
      { idleStopMinutes: 10 }, { previewRetentionDays: 1 }, { archiveRetentionDays: 1 }, { maxConcurrentRuns: 1 },
      { sshTarget: 'knecht@example.com' }, { autoUpdateCron: '0 3 * * *' },
    ]
    access.owner = false
    for (const body of changes) expect((await send(body)).status).toBe(403)
    access.owner = true
    access.elevated = false
    for (const body of changes) expect((await send(body)).json).toMatchObject({ statusCode: 403, data: { reauth: true } })
    access.elevated = true
  })

  it('lets any member change the agent instructions', async () => {
    access.owner = false
    access.elevated = false
    const res = await send({ agentInstructions: 'Answer in German.' })
    access.owner = true
    access.elevated = true
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ agentInstructions: 'Answer in German.' })
  })
})
