import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Settings } from '../db/schema'

export function getSettingsRow(): Settings {
  const existing = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()
  if (existing) return existing
  db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing().run()
  return db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()!
}

export function updateSettingsRow(patch: Partial<Omit<Settings, 'id'>>): void {
  getSettingsRow()
  if (Object.keys(patch).length) db.update(schema.settings).set(patch).where(eq(schema.settings.id, 1)).run()
}
