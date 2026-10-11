import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database, { type RunResult } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from './schema'

const dbPath = process.env.KNECHT_DB_PATH || '.data/knecht.db'
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite, { schema })
export type Executor = BaseSQLiteDatabase<'sync', RunResult, typeof schema>
export { schema }
