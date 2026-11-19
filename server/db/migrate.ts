import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '#server/db/index'
import { runDataMigrations } from '#server/db/data-migrations'

// SQL first: it creates the data_migrations table the JS migrations record into.
export function migrateDatabase(): void {
  migrate(db, { migrationsFolder: 'server/db/migrations' })
  runDataMigrations()
}
