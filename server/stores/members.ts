import { and, asc, count, eq, getTableColumns, isNull } from 'drizzle-orm'
import { db } from '../db'
import { memberIdentities, members, type Member, type MemberIdentity } from '../db/schema'
import type { RepoProvider } from '../../shared/utils/integrations'
import { liveTopics } from '../../shared/utils/live-topics'
import { emitTopics } from '../utils/live'

const norm = (login: string) => login.trim().toLowerCase()

interface Profile {
  login: string
  name?: string | null
  avatarUrl?: string | null
}

export interface ProviderAccount {
  subject: string
  username: string
}

const { passwordHash: _, ...publicColumns } = getTableColumns(members)

export function listMembers(): Omit<Member, 'passwordHash'>[] {
  return db.select(publicColumns).from(members).orderBy(asc(members.createdAt)).all()
}

export function getMember(login: string): Member | undefined {
  return db.select().from(members).where(eq(members.login, norm(login))).get()
}

export function getMemberById(id: unknown): Member | undefined {
  if (typeof id !== 'number') return undefined
  return db.select().from(members).where(eq(members.id, id)).get()
}

export function memberCount(): number {
  return db.select({ count: count() }).from(members).get()?.count ?? 0
}

export function getIdentity(provider: RepoProvider, username: string): MemberIdentity | undefined {
  return db.select().from(memberIdentities)
    .where(and(eq(memberIdentities.provider, provider), eq(memberIdentities.username, norm(username))))
    .get()
}

export function hasVerifiedIdentity(provider: RepoProvider, username: string): boolean {
  return getIdentity(provider, username)?.verified ?? false
}

// The identity stays pending until its first login.
export function addMember(p: Profile & { isOwner?: boolean, invitedBy?: string | null, passwordHash?: string, identity?: { provider: RepoProvider, username: string } }): Member {
  const member = db.insert(members)
    .values({
      login: norm(p.login),
      name: p.name ?? null,
      avatarUrl: p.avatarUrl ?? null,
      isOwner: p.isOwner ?? false,
      invitedBy: p.invitedBy ?? null,
      passwordHash: p.passwordHash ?? null,
    })
    .returning()
    .get()
  if (p.identity) {
    db.insert(memberIdentities)
      .values({ memberId: member.id, provider: p.identity.provider, username: norm(p.identity.username) })
      .run()
  }
  emitTopics(liveTopics.members)
  return member
}

// A pending identity is claimed by the first login with its username; an empty
// instance makes the first login its owner. Answers undefined for anyone else.
export function loginWithIdentity(provider: RepoProvider, account: ProviderAccount, profile: Omit<Profile, 'login'>): Member | undefined {
  const username = norm(account.username)
  const known = db.select().from(memberIdentities)
    .where(and(eq(memberIdentities.provider, provider), eq(memberIdentities.subject, account.subject)))
    .get()
  const identity = known ?? db.select().from(memberIdentities)
    .where(and(eq(memberIdentities.provider, provider), eq(memberIdentities.username, username), isNull(memberIdentities.subject)))
    .get()

  let memberId = identity?.memberId
  if (identity) {
    db.update(memberIdentities)
      .set({ subject: account.subject, username, verified: true })
      .where(eq(memberIdentities.id, identity.id))
      .run()
  }
  else if (memberCount() === 0) {
    memberId = addMember({ login: username, isOwner: true, identity: { provider, username } }).id
    db.update(memberIdentities)
      .set({ subject: account.subject, verified: true })
      .where(eq(memberIdentities.memberId, memberId))
      .run()
  }
  if (memberId === undefined) return undefined

  const member = db.update(members)
    .set({ name: profile.name ?? null, avatarUrl: profile.avatarUrl ?? null })
    .where(eq(members.id, memberId))
    .returning()
    .get()
  emitTopics(liveTopics.members)
  return member
}

export function removeMember(login: string): void {
  db.delete(members).where(eq(members.login, norm(login))).run()
  emitTopics(liveTopics.members)
}
