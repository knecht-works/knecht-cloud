import { describe, expect, it } from 'vitest'

const { addMember, getMemberById, hasVerifiedIdentity, loginWithIdentity } = await import('../../server/stores/members')

const profile = { name: 'Octo Cat', avatarUrl: 'https://avatars/1' }

describe('loginWithIdentity', () => {
  it('makes the first login of an empty instance its owner', () => {
    const owner = loginWithIdentity('github', { subject: '1', username: 'Owner' }, profile)!
    expect(owner).toMatchObject({ login: 'owner', isOwner: true, name: 'Octo Cat' })
    expect(hasVerifiedIdentity('github', 'owner')).toBe(true)
  })

  it('refuses a stranger once the instance has members', () => {
    expect(loginWithIdentity('github', { subject: '2', username: 'stranger' }, profile)).toBeUndefined()
  })

  it('lets an invited member claim the pending identity, and counts mentions only from then on', () => {
    const invited = addMember({ login: 'invited', identity: { provider: 'github', username: 'Invited' } })
    expect(hasVerifiedIdentity('github', 'invited')).toBe(false)

    expect(loginWithIdentity('github', { subject: '3', username: 'invited' }, profile)?.id).toBe(invited.id)
    expect(hasVerifiedIdentity('github', 'invited')).toBe(true)
  })

  it('finds a member by subject after a rename on the provider, and keeps the Knecht username', () => {
    const member = loginWithIdentity('github', { subject: '3', username: 'renamed' }, profile)!
    expect(member.login).toBe('invited')
    expect(hasVerifiedIdentity('github', 'renamed')).toBe(true)
    expect(hasVerifiedIdentity('github', 'invited')).toBe(false)
  })

  it('does not hand a claimed username to another account', () => {
    expect(loginWithIdentity('github', { subject: '4', username: 'renamed' }, profile)).toBeUndefined()
  })
})

describe('getMemberById', () => {
  it('answers nothing for a session from before member ids', () => {
    expect(getMemberById(undefined)).toBeUndefined()
  })
})
