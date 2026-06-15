import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Settings } from '../db/schema'

// Instance settings live in a single row (id = 1). Read through this helper so
// callers never deal with the row's absence — it self-seeds with the schema
// defaults on first access.
export function getSettings(): Settings {
  const existing = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()
  if (existing) return existing
  db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing().run()
  return db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()!
}

// Apply a partial update to the singleton row and return the new state.
export type SettingsPatch = Partial<Omit<Settings, 'id'>>
export function updateSettings(patch: SettingsPatch): Settings {
  getSettings() // ensure the row exists
  if (Object.keys(patch).length) {
    db.update(schema.settings).set(patch).where(eq(schema.settings.id, 1)).run()
  }
  return getSettings()
}
