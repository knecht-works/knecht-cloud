import { asc, count, eq } from 'drizzle-orm'
import { db } from '../db'
import { members, type Member } from '../db/schema'

const norm = (login: string) => login.trim().toLowerCase()

interface Profile {
  login: string
  name?: string | null
  avatarUrl?: string | null
}

export function listMembers(): Member[] {
  return db.select().from(members).orderBy(asc(members.createdAt)).all()
}

export function getMember(login: string): Member | undefined {
  return db.select().from(members).where(eq(members.login, norm(login))).get()
}

export function isMember(login: string): boolean {
  return getMember(login) !== undefined
}

export function memberCount(): number {
  return db.select({ count: count() }).from(members).get()?.count ?? 0
}

export function addMember(p: Profile & { isOwner?: boolean, invitedBy?: string | null }): void {
  db.insert(members)
    .values({
      login: norm(p.login),
      name: p.name ?? null,
      avatarUrl: p.avatarUrl ?? null,
      isOwner: p.isOwner ?? false,
      invitedBy: p.invitedBy ?? null,
    })
    .onConflictDoNothing({ target: members.login })
    .run()
}

export function touchProfile(p: Profile): void {
  db.update(members)
    .set({ name: p.name ?? null, avatarUrl: p.avatarUrl ?? null })
    .where(eq(members.login, norm(p.login)))
    .run()
}

export function removeMember(login: string): void {
  db.delete(members).where(eq(members.login, norm(login))).run()
}
