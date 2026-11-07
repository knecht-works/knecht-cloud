import { describe, expect, it } from 'vitest'

const { db, schema } = await import('../../server/db')
const { addMember } = await import('../../server/stores/members')
const { consumePasswordReset, createPasswordReset, findOpenPasswordReset } = await import('../../server/stores/password-resets')

describe('password resets', () => {
  it('works once, and a new link replaces the older one', () => {
    const member = addMember({ login: 'forgetful', passwordHash: 'old' })
    const first = createPasswordReset(member.id)
    const second = createPasswordReset(member.id)
    expect(findOpenPasswordReset(first.token)).toBeUndefined()
    expect(consumePasswordReset(second.token)).toEqual({ memberId: member.id })
    expect(consumePasswordReset(second.token)).toBeUndefined()
  })

  it('expires after 24 hours', () => {
    const member = addMember({ login: 'late', passwordHash: 'old' })
    const { token, expiresAt } = createPasswordReset(member.id)
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000)
    db.update(schema.passwordResets).set({ expiresAt: new Date(Date.now() - 1000) }).run()
    expect(findOpenPasswordReset(token)).toBeUndefined()
  })
})
