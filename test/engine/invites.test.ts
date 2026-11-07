import { describe, expect, it } from 'vitest'

const { db, schema } = await import('../../server/db')
const { consumeInvite, createInvite, findOpenInvite, listOpenInvites, revokeInvite } = await import('../../server/stores/invites')

describe('invites', () => {
  it('works once and never exposes the token', () => {
    const { invite, token } = createInvite('owner')
    expect(invite).not.toHaveProperty('tokenHash')
    expect(listOpenInvites().map(i => i.id)).toContain(invite.id)
    expect(JSON.stringify(listOpenInvites())).not.toContain(token)

    expect(consumeInvite(token)?.createdBy).toBe('owner')
    expect(consumeInvite(token)).toBeUndefined()
    expect(findOpenInvite(token)).toBeUndefined()
  })

  it('expires after its deadline', () => {
    const { invite, token } = createInvite('owner')
    db.update(schema.invites).set({ expiresAt: new Date(Date.now() - 1000) }).run()
    expect(findOpenInvite(token)).toBeUndefined()
    expect(consumeInvite(token)).toBeUndefined()
    expect(listOpenInvites().map(i => i.id)).not.toContain(invite.id)
  })

  it('stops working when revoked', () => {
    const { invite, token } = createInvite('owner')
    revokeInvite(invite.id)
    expect(findOpenInvite(token)).toBeUndefined()
  })
})
