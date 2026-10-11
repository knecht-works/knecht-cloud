import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './index'
import { runDataMigrations } from './data-migrations'

// SQL first: it creates the data_migrations table the JS migrations record into.
export function migrateDatabase(): void {
  migrate(db, { migrationsFolder: 'server/db/migrations' })
  runDataMigrations()
}
