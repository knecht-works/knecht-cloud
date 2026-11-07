import { and, asc, eq, gt } from 'drizzle-orm'
import { db } from '../db'
import { invites, type Invite } from '../db/schema'
import { hashLinkToken as hash, newLinkToken } from '../utils/link-token'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const open = () => gt(invites.expiresAt, new Date())

export function createInvite(createdBy: string): { invite: Omit<Invite, 'tokenHash'>, token: string } {
  const token = newLinkToken()
  const { tokenHash: _, ...invite } = db.insert(invites)
    .values({ tokenHash: hash(token), createdBy, expiresAt: new Date(Date.now() + INVITE_TTL_MS) })
    .returning()
    .get()
  return { invite, token }
}

export function listOpenInvites(): Omit<Invite, 'tokenHash'>[] {
  return db.select({ id: invites.id, createdBy: invites.createdBy, expiresAt: invites.expiresAt, createdAt: invites.createdAt })
    .from(invites)
    .where(open())
    .orderBy(asc(invites.createdAt))
    .all()
}

export function findOpenInvite(token: string): Invite | undefined {
  return db.select().from(invites).where(and(eq(invites.tokenHash, hash(token)), open())).get()
}

// Deleting is what makes an invite single use: of two concurrent joins only one gets the row back.
export function consumeInvite(token: string): Invite | undefined {
  return db.delete(invites).where(and(eq(invites.tokenHash, hash(token)), open())).returning().get()
}

export function revokeInvite(id: number): void {
  db.delete(invites).where(eq(invites.id, id)).run()
}
