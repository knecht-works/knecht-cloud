import { eq } from 'drizzle-orm'
import { db, schema } from '../db'

// Remember the latest GitHub OAuth token so background trigger runs (scheduled or
// webhook-fired — neither has a session) have a clone/PR credential. Upserts the
// singleton row (id = 1). See the `credentials` table note in db/schema.ts.
export function rememberGithubToken(token: string, login?: string | null): void {
  db.insert(schema.credentials)
    .values({ id: 1, githubToken: token, githubLogin: login ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.credentials.id,
      set: { githubToken: token, githubLogin: login ?? null, updatedAt: new Date() },
    })
    .run()
}

// The remembered token, or null if nobody has logged in on this instance yet.
export function getServiceToken(): string | null {
  return db.select().from(schema.credentials).where(eq(schema.credentials.id, 1)).get()?.githubToken ?? null
}
