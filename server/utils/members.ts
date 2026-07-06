import { asc, count, eq } from 'drizzle-orm'
import { db } from '../db'
import { members, type Member } from '../db/schema'

// The login allowlist that gates who may sign in. First-run setup claims the
// GitHub App owner as the sole initial member (server/routes/setup/callback);
// afterwards any member can invite more logins (server/api/members/*). The gate
// itself lives in server/routes/auth/github.get.ts. GitHub logins are
// case-insensitive, so every login is normalised to lowercase here: the one
// place that touches the table.

const norm = (login: string) => login.trim().toLowerCase()

interface Profile {
  login: string
  name?: string | null
  avatarUrl?: string | null
}

// All members, oldest first (the owner, seeded at setup, sorts first).
export function listMembers(): Member[] {
  return db.select().from(members).orderBy(asc(members.createdAt)).all()
}

export function getMember(login: string): Member | undefined {
  return db.select().from(members).where(eq(members.login, norm(login))).get()
}

export function isMember(login: string): boolean {
  return getMember(login) !== undefined
}

// Zero members means the instance hasn't been claimed yet: the login gate uses
// this to let the first successful login claim ownership (covers instances set
// up before member gating existed).
export function memberCount(): number {
  return db.select({ count: count() }).from(members).get()?.count ?? 0
}

// Add a member. An already-present login is left untouched (never downgrades an
// owner or reassigns `invitedBy`); use touchProfile to refresh its display data.
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

// Refresh a member's display profile from GitHub (called on each login so the
// members list shows real names/avatars). No-op for a non-member.
export function touchProfile(p: Profile): void {
  db.update(members)
    .set({ name: p.name ?? null, avatarUrl: p.avatarUrl ?? null })
    .where(eq(members.login, norm(p.login)))
    .run()
}

export function removeMember(login: string): void {
  db.delete(members).where(eq(members.login, norm(login))).run()
}
