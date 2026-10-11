import { eq } from 'drizzle-orm'
import { db } from '../db'
import { githubApp, type GithubAppRow, type NewGithubAppRow } from '../db/schema'

export function getGithubAppRow(): GithubAppRow | undefined {
  return db.select().from(githubApp).where(eq(githubApp.id, 1)).get()
}

export function saveGithubAppRow(values: Omit<NewGithubAppRow, 'id'>): void {
  db.insert(githubApp).values({ id: 1, ...values }).run()
}
