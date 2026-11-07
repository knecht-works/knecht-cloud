import { and, eq, gt } from 'drizzle-orm'
import { db } from '../db'
import { passwordResets } from '../db/schema'
import { hashLinkToken, newLinkToken } from '../utils/link-token'

const RESET_TTL_MS = 24 * 60 * 60 * 1000

const open = (token: string) => and(eq(passwordResets.tokenHash, hashLinkToken(token)), gt(passwordResets.expiresAt, new Date()))

// A new link replaces the member's older ones.
export function createPasswordReset(memberId: number): { token: string, expiresAt: Date } {
  const token = newLinkToken()
  const expiresAt = new Date(Date.now() + RESET_TTL_MS)
  db.delete(passwordResets).where(eq(passwordResets.memberId, memberId)).run()
  db.insert(passwordResets).values({ memberId, tokenHash: hashLinkToken(token), expiresAt }).run()
  return { token, expiresAt }
}

export function findOpenPasswordReset(token: string): { memberId: number } | undefined {
  return db.select({ memberId: passwordResets.memberId }).from(passwordResets).where(open(token)).get()
}

export function consumePasswordReset(token: string): { memberId: number } | undefined {
  return db.delete(passwordResets).where(open(token)).returning({ memberId: passwordResets.memberId }).get()
}
