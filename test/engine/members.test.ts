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

describe('linkIdentity and unlinkIdentity', () => {
  it('links GitHub to a password member, and unlinks it while the password remains', async () => {
    const { linkIdentity, listIdentities, unlinkIdentity } = await import('../../server/stores/members')
    const member = addMember({ login: 'pw-only', passwordHash: 'hash' })

    expect(linkIdentity(member.id, 'github', { subject: '50', username: 'PwGithub' })).toBe('linked')
    expect(listIdentities(member.id)).toMatchObject([{ provider: 'github', subject: '50', username: 'pwgithub', verified: true }])
    expect(loginWithIdentity('github', { subject: '50', username: 'pwgithub' }, profile)?.id).toBe(member.id)

    expect(unlinkIdentity(member.id, 'github')).toBe(true)
    expect(listIdentities(member.id)).toEqual([])
  })

  it('never takes an account that belongs to another member', async () => {
    const { linkIdentity } = await import('../../server/stores/members')
    const member = addMember({ login: 'thief', passwordHash: 'hash' })
    expect(linkIdentity(member.id, 'github', { subject: '1', username: 'whatever' })).toBe('taken')
    expect(linkIdentity(member.id, 'github', { subject: '99', username: 'owner' })).toBe('taken')
  })

  it('keeps the last way to sign in', async () => {
    const { unlinkIdentity } = await import('../../server/stores/members')
    const owner = loginWithIdentity('github', { subject: '1', username: 'owner' }, profile)!
    expect(unlinkIdentity(owner.id, 'github')).toBe(false)
    expect(hasVerifiedIdentity('github', 'owner')).toBe(true)
  })
})

describe('setOwner', () => {
  it('promotes and demotes, but always keeps one owner', async () => {
    const { listMembers, setOwner } = await import('../../server/stores/members')
    const owners = () => listMembers().filter(m => m.isOwner).map(m => m.login)
    const second = addMember({ login: 'second-owner', passwordHash: 'hash' })
    expect(setOwner(second.id, true)).toBe(true)
    for (const m of listMembers().filter(m => m.isOwner && m.id !== second.id)) expect(setOwner(m.id, false)).toBe(true)
    expect(owners()).toEqual(['second-owner'])
    expect(setOwner(second.id, false)).toBe(false)
    expect(owners()).toEqual(['second-owner'])
  })
})

describe('own name and picture', () => {
  it('survive a later provider login', async () => {
    const { setAvatarImage, setName } = await import('../../server/stores/members')
    const owner = loginWithIdentity('github', { subject: '1', username: 'owner' }, profile)!
    setName(owner.id, 'Sam')
    setAvatarImage(owner.id, 'data:image/png;base64,AAAA')

    const after = loginWithIdentity('github', { subject: '1', username: 'owner' }, { name: 'GitHub Name', avatarUrl: 'https://avatars/2' })!
    expect(after.name).toBe('Sam')
    expect(after.avatarUrl).toMatch(new RegExp(`^/api/avatars/${owner.id}\\?v=\\d+$`))

    setName(owner.id, null)
    setAvatarImage(owner.id, null)
    expect(loginWithIdentity('github', { subject: '1', username: 'owner' }, { name: 'GitHub Name', avatarUrl: 'https://avatars/2' })).toMatchObject({ name: 'GitHub Name', avatarUrl: 'https://avatars/2' })
  })
})
