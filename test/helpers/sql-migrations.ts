import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

const SOURCE = 'server/db/migrations'

// A database migrated up to and including `tag`, plus a function that applies the rest:
// the shape an existing instance has when it upgrades.
export function databaseAt(tag: string) {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  const folder = mkdtempSync(join(tmpdir(), 'knecht-migrations-'))
  cpSync(SOURCE, folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
  const end = journal.entries.findIndex(e => e.tag === tag)
  if (end < 0) throw new Error(`unknown migration ${tag}`)
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, end + 1) }))
  migrate(db, { migrationsFolder: folder })
  return {
    sqlite,
    upgrade: () => migrate(db, { migrationsFolder: SOURCE }),
  }
}
