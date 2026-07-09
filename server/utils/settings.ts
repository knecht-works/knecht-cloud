import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { decrypt } from './crypto'
import type { Settings } from '../db/schema'

// Instance settings live in a single row (id = 1). Read through this helper so
// callers never deal with the row's absence: it self-seeds with the schema
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

// The client-facing shape: secrets stripped, replaced by configured-flags and
// a recognition preview. EVERY settings response goes through this: a new
// secret column gets its redaction here, once.
export function publicSettings(settings: Settings) {
  const { aiKeyEnc, ...rest } = settings
  return {
    ...rest,
    aiKeyConfigured: !!aiKeyEnc,
    aiKeyPreview: aiKeyEnc ? encKeyPreview(aiKeyEnc) : undefined,
  }
}

// First 8 + last 4 characters stay visible so the operator can tell WHICH key
// is stored; the middle is masked (star count capped: the field shouldn't
// grow with the key, and the hidden length carries no information anyway).
export function keyPreview(key: string): string {
  if (key.length <= 12) return '*'.repeat(key.length)
  return `${key.slice(0, 8)}${'*'.repeat(Math.min(key.length - 12, 16))}${key.slice(-4)}`
}

function encKeyPreview(enc: string): string | undefined {
  try {
    return keyPreview(decrypt(enc))
  }
  catch {
    // Undecryptable (rotated NUXT_SESSION_PASSWORD): no preview, key needs re-entry.
    return undefined
  }
}
